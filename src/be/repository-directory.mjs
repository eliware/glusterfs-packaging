import path from "node:path";
import { promises as fs } from "node:fs";
import { resolvePublicPath } from "./path-utils.mjs";
import { assertMetadataVersion } from "./metadata-version.mjs";

let cachedIndex = null;
let cachedIndexStamp = "";

function directoryKey(requestPath) {
  if (!requestPath || requestPath === "/") return "/";
  return `/${requestPath.replace(/^\/+|\/+$/g, "")}/`;
}

async function readIndex(config) {
  const indexPath = path.join(
    config.publicDir,
    "metadata/repository-index.json",
  );
  try {
    const stats = await fs.stat(indexPath);
    const stamp = `${stats.mtimeMs}:${stats.size}`;
    if (cachedIndex && cachedIndexStamp === stamp) return cachedIndex;
    cachedIndex = assertMetadataVersion(
      JSON.parse(await fs.readFile(indexPath, "utf8")),
      "repository-index.json",
    );
    cachedIndexStamp = stamp;
    return cachedIndex;
  } catch {
    cachedIndex = null;
    cachedIndexStamp = "";
    return null;
  }
}

function sortEntries(entries, sort, order) {
  const direction = order === "desc" ? -1 : 1;
  return [...entries].sort((left, right) => {
    if (sort === "size")
      return direction * ((left.size ?? -1) - (right.size ?? -1));
    if (sort === "modified")
      return (
        direction *
        String(left.modified || "").localeCompare(String(right.modified || ""))
      );
    return (
      direction *
      (Number(right.type === "directory") - Number(left.type === "directory") ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
    );
  });
}

function paginate(entries, options) {
  const query = String(options.query || "")
    .trim()
    .toLowerCase();
  const filtered = query
    ? entries.filter((entry) => entry.name.toLowerCase().includes(query))
    : entries;
  const sorted = sortEntries(filtered, options.sort, options.order);
  const offset = Math.max(0, Number.parseInt(options.offset || "0", 10) || 0);
  const limit = Math.min(
    500,
    Math.max(1, Number.parseInt(options.limit || "500", 10) || 500),
  );
  return {
    entries: sorted.slice(offset, offset + limit),
    total: sorted.length,
    offset,
    limit,
    hasMore: offset + limit < sorted.length,
  };
}

export async function repositoryDirectory(config, requestPath, options = {}) {
  const index = await readIndex(config);
  if (index?.directories?.[directoryKey(requestPath)]) {
    const listing = index.directories[directoryKey(requestPath)];
    const page = paginate(listing.entries || [], options);
    return {
      path: requestPath,
      total: page.total,
      offset: page.offset,
      limit: page.limit,
      hasMore: page.hasMore,
      entries: page.entries,
      validation: listing.validation || null,
      container_validation: listing.container_validation || null,
    };
  }

  const filePath =
    requestPath === "/"
      ? path.resolve(config.publicDir)
      : resolvePublicPath(config.publicDir, requestPath);
  if (!filePath) return null;
  const publicRoot = await fs.realpath(config.publicDir);
  const resolvedPath = await fs.realpath(filePath);
  const normalizedRoot = path.resolve(publicRoot);
  if (
    resolvedPath !== normalizedRoot &&
    !resolvedPath.startsWith(`${normalizedRoot}${path.sep}`)
  )
    return null;
  const stats = await fs.stat(resolvedPath);
  if (!stats.isDirectory()) return null;
  const readJson = async (name) => {
    try {
      return JSON.parse(
        await fs.readFile(path.join(resolvedPath, name), "utf8"),
      );
    } catch {
      return null;
    }
  };
  const entries = (await fs.readdir(resolvedPath, { withFileTypes: true }))
    .filter((entry) => config.allowDotfiles || !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      href: `${requestPath}${encodeURIComponent(entry.name)}${entry.isDirectory() ? "/" : ""}`,
    }));
  const page = paginate(entries, options);
  return {
    path: requestPath,
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.hasMore,
    validation: await readJson("validation.json"),
    container_validation: await readJson("container-validation.json"),
    entries: page.entries,
  };
}
