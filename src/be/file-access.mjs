import { createReadStream } from "node:fs";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createBrotliCompress, createGzip } from "node:zlib";
import { chooseEncoding } from "./response.mjs";

export async function fileExists(filePath, config) {
  try {
    const resolvedPublicDir = await fs.realpath(config.publicDir);
    const resolvedFilePath = config.allowSymlinks
      ? path.resolve(filePath)
      : await fs.realpath(filePath);
    const publicPrefix = path.resolve(resolvedPublicDir) + path.sep;
    if (!resolvedFilePath.startsWith(publicPrefix)) return null;
    const cached = config.ramCacheStore?.get(resolvedFilePath);
    if (cached)
      return { path: resolvedFilePath, stats: cached.stats, body: cached.body };
    const stats = await fs.stat(resolvedFilePath);
    return stats.isFile() ? { path: resolvedFilePath, stats } : null;
  } catch {
    return null;
  }
}

export async function staticFileExists(root, requestPath, config) {
  try {
    const publicRoot = await fs.realpath(root);
    const candidate = path.resolve(
      root,
      `.${requestPath === "/" ? "/index.html" : requestPath}`,
    );
    const filePath = config.allowSymlinks
      ? candidate
      : await fs.realpath(candidate);
    if (!filePath.startsWith(`${path.resolve(publicRoot)}${path.sep}`))
      return null;
    const stats = await fs.stat(filePath);
    return stats.isFile() ? { path: filePath, stats } : null;
  } catch {
    return null;
  }
}

export async function preloadStaticCache(config) {
  const cache = new Map();
  if (!config.ramCache) return cache;
  let totalBytes = 0;
  const publicRoot = await fs.realpath(config.publicDir);
  for (const requestedPath of config.ramCachePaths) {
    const candidate = path.resolve(
      config.publicDir,
      `.${requestedPath.startsWith("/") ? requestedPath : `/${requestedPath}`}`,
    );
    try {
      const filePath = await fs.realpath(candidate);
      if (!filePath.startsWith(`${publicRoot}${path.sep}`)) continue;
      const stats = await fs.stat(filePath);
      if (!stats.isFile() || totalBytes + stats.size > config.ramCacheMaxBytes)
        continue;
      cache.set(filePath, { body: await fs.readFile(filePath), stats });
      totalBytes += stats.size;
    } catch {
      /* optional assets may not exist yet */
    }
  }
  return cache;
}

export function streamFile(
  response,
  filePath,
  stats,
  range,
  config,
  fileHeaders,
  request,
) {
  const headers = {
    ...fileHeaders(filePath, stats, config),
    ...(config.byteRanges ? { "Accept-Ranges": "bytes" } : {}),
  };
  if (range) {
    headers["Content-Range"] =
      `bytes ${range.start}-${range.end}/${stats.size}`;
    headers["Content-Length"] = range.end - range.start + 1;
    response.writeHead(206, headers);
    const stream = createReadStream(filePath, {
      start: range.start,
      end: range.end,
    });
    stream.on("error", () => response.destroy());
    stream.pipe(response);
    return;
  }
  const encoding = chooseEncoding(
    request,
    headers["Content-Type"],
    stats.size,
    config,
  );
  if (encoding) {
    delete headers["Content-Length"];
    headers["Content-Encoding"] = encoding;
    headers.Vary = "Accept-Encoding";
  } else headers["Content-Length"] = stats.size;
  response.writeHead(200, headers);
  const stream = createReadStream(filePath);
  stream.on("error", () => response.destroy());
  if (encoding === "br") stream.pipe(createBrotliCompress()).pipe(response);
  else if (encoding === "gzip") stream.pipe(createGzip()).pipe(response);
  else stream.pipe(response);
}
