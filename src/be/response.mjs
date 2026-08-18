import { getContentType } from "./mime-type.mjs";
import { readFile } from "node:fs/promises";
import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

function accepts(request, encoding) {
  return String(request?.headers?.["accept-encoding"] || "")
    .toLowerCase()
    .split(",")
    .some((value) => value.trim().split(";")[0] === encoding);
}

export function chooseEncoding(request, contentType, length, config) {
  if (
    !config.compression ||
    length < config.compressionMinBytes ||
    !/^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/i.test(
      contentType,
    )
  )
    return null;
  if (accepts(request, "br")) return "br";
  if (accepts(request, "gzip")) return "gzip";
  return null;
}

export async function compressBody(body, request, contentType, config) {
  const encoding = chooseEncoding(request, contentType, body.length, config);
  if (!encoding) return { body, headers: {} };
  return {
    body:
      encoding === "br"
        ? await brotliCompressAsync(body)
        : await gzipAsync(body),
    headers: { "Content-Encoding": encoding, Vary: "Accept-Encoding" },
  };
}

export function baseHeaders(config) {
  const headers = {};
  if (config.securityHeaders) {
    headers["X-Content-Type-Options"] = "nosniff";
    headers["X-Frame-Options"] = "SAMEORIGIN";
    headers["Referrer-Policy"] = "no-referrer";
  }
  if (config.corsOrigin)
    headers["Access-Control-Allow-Origin"] = config.corsOrigin;
  if (config.cacheControl) headers["Cache-Control"] = config.cacheControl;
  return headers;
}

export async function sendText(
  response,
  statusCode,
  message,
  config,
  headers = {},
) {
  const contentType = "text/plain; charset=utf-8";
  const encoded = await compressBody(
    Buffer.from(message),
    response.req,
    contentType,
    config,
  );
  response.writeHead(statusCode, {
    ...baseHeaders(config),
    "Content-Type": contentType,
    "Content-Length": encoded.body.length,
    ...encoded.headers,
    ...headers,
  });
  response.end(response.req?.method === "HEAD" ? undefined : encoded.body);
}

export async function sendError(
  response,
  statusCode,
  message,
  config,
  customFile = "",
  headers = {},
) {
  if (customFile) {
    try {
      const body = await readFile(customFile);
      response.writeHead(statusCode, {
        ...baseHeaders(config),
        "Content-Type": getContentType(customFile, config.defaultMimeType),
        "Content-Length": body.length,
        ...headers,
      });
      response.end(body);
      return;
    } catch {
      /* use the built-in response */
    }
  }
  await sendText(response, statusCode, message, config, headers);
}

export async function sendJson(
  response,
  statusCode,
  value,
  config,
  cacheControl = "no-cache, must-revalidate",
) {
  const body = `${JSON.stringify(value)}\n`;
  const contentType = "application/json; charset=utf-8";
  const encoded = await compressBody(
    Buffer.from(body),
    response.req,
    contentType,
    config,
  );
  response.writeHead(statusCode, {
    ...baseHeaders(config),
    "Cache-Control": cacheControl,
    "Content-Type": contentType,
    "Content-Length": encoded.body.length,
    ...encoded.headers,
  });
  response.end(response.req?.method === "HEAD" ? undefined : encoded.body);
}

export function fileHeaders(filePath, stats, config) {
  const headers = {
    ...baseHeaders(config),
    "Content-Type": getContentType(filePath, config.defaultMimeType),
  };
  if (config.lastModified) headers["Last-Modified"] = stats.mtime.toUTCString();
  if (config.etag)
    headers.ETag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
  return headers;
}
