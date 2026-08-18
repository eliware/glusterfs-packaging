#!/usr/bin/env node
import { createHash } from "node:crypto";
import path from "node:path";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { readMetadata, writeMetadata } from "./metadata-io.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1)
  if (process.argv[index].startsWith("--"))
    args.set(process.argv[index].slice(2), process.argv[++index]);
const root = args.get("root");
const output =
  args.get("output") || path.join(root || "", "metadata/repository-index.json");
if (!root) throw new Error("missing --root");

const ignored = new Set([
  ".generations",
  "publication.lock",
  "repository-index.json",
  "repository-index.json.asc",
  "release-manifest.json",
  "release-manifest.json.asc",
]);

function normalizedDirectory(value) {
  if (!value || value === "/") return "/";
  return `/${value.replace(/^\/+|\/+$/g, "")}/`;
}

function href(directory, name, directoryEntry) {
  return `${directory}${encodeURIComponent(name)}${directoryEntry ? "/" : ""}`;
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function packageMetadata(name) {
  if (name.endsWith(".rpm")) return { format: "rpm", filename: name };
  if (name.endsWith(".deb")) return { format: "deb", filename: name };
  return undefined;
}

const directories = {};
async function scan(directory, relative = "/") {
  const directoryPath = normalizedDirectory(relative);
  const entries = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith(".")) continue;
    const fullPath = path.join(directory, entry.name);
    const info = await stat(fullPath);
    const isDirectory = info.isDirectory();
    const item = {
      name: entry.name,
      type: isDirectory ? "directory" : "file",
      size: isDirectory ? null : info.size,
      modified: info.mtime.toISOString(),
      href: href(directoryPath, entry.name, isDirectory),
    };
    if (!isDirectory) {
      item.sha256 = await hashFile(fullPath);
      const packageInfo = packageMetadata(entry.name);
      if (packageInfo) item.package = packageInfo;
    }
    entries.push(item);
  }
  entries.sort(
    (left, right) =>
      Number(right.type === "directory") - Number(left.type === "directory") ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
  directories[directoryPath] = {
    path: directoryPath,
    entries,
    total: entries.length,
  };
  for (const metadataName of [
    "validation.json",
    "container-validation.json",
    "metadata.json",
    "provenance.json",
  ]) {
    try {
      directories[directoryPath][metadataName.replace(".json", "")] =
        await readMetadata(path.join(directory, metadataName));
    } catch {
      /* Metadata is optional for ordinary repository directories. */
    }
  }
  for (const entry of entries.filter((item) => item.type === "directory"))
    await scan(
      path.join(directory, entry.name),
      `${directoryPath}${entry.name}/`,
    );
}

await scan(root);
const index = {
  schema: 1,
  generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  directories,
};
await writeMetadata(output, index, {
  atomic: true,
  required: ["schema", "generated", "directories"],
});
console.log(
  `Generated repository index with ${Object.keys(directories).length} directories`,
);
