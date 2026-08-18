import path from "node:path";
import { promises as fs } from "node:fs";
import { sendDirectoryListing } from "./directory-listing.mjs";
import { fileExists, streamFile } from "./file-access.mjs";
import {
  compressBody,
  fileHeaders,
  sendError,
  sendText,
  baseHeaders,
} from "./response.mjs";
import { handleSpecialRequest } from "./special-routes.mjs";
import { getRequestPath, resolvePublicPath } from "./path-utils.mjs";
import { parseByteRange } from "./range-utils.mjs";
import { randomUUID } from "node:crypto";
import { recordRequest, startRequest } from "./metrics.mjs";
import { createBlogStore } from "./blog-store.mjs";

export function createRequestListener(config) {
  if (!config.blogStore) config.blogStore = createBlogStore(config.blogDir);
  const allowedMethods = [
    config.allowGet ? "GET" : "",
    config.allowHead ? "HEAD" : "",
  ].filter(Boolean);
  return async function requestListener(request, response) {
    const started = Date.now();
    const requestId = request.headers?.["x-request-id"] || randomUUID();
    response.setHeader?.("X-Request-ID", requestId);
    startRequest();
    const finish = () => {
      const durationMs = Date.now() - started;
      const bytes =
        Number(
          typeof response.getHeader === "function"
            ? response.getHeader("Content-Length")
            : 0,
        ) || 0;
      recordRequest({
        method: request.method,
        path: request.url,
        status: response.statusCode,
        durationMs,
        bytes,
      });
      if (config.accessLog && config.logLevel !== "silent") {
        const entry = {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          method: request.method || "-",
          path: request.url || "/",
          status: response.statusCode,
          duration_ms: durationMs,
          bytes,
        };
        console.log(
          config.structuredLogs
            ? JSON.stringify(entry)
            : `${entry.method} ${entry.path} ${entry.status} ${entry.duration_ms}ms`,
        );
      }
    };
    response.once("finish", finish);

    if (!allowedMethods.includes(request.method || "")) {
      await sendError(
        response,
        405,
        "Method Not Allowed",
        config,
        config.methodNotAllowedFile,
        { Allow: allowedMethods.join(", ") },
      );
      return;
    }
    let requestPath;
    try {
      requestPath = getRequestPath(request.url || "/");
    } catch {
      sendText(response, 400, "Bad Request", config);
      return;
    }
    if (await handleSpecialRequest(request, response, requestPath, config))
      return;
    if (requestPath.split("/").some((part) => part === "..")) {
      sendText(response, 400, "Bad Request", config);
      return;
    }
    if (
      !config.allowDotfiles &&
      requestPath.split("/").some((part) => part.startsWith("."))
    ) {
      await sendError(response, 404, "Not Found", config, config.notFoundFile);
      return;
    }

    let filePath = resolvePublicPath(config.publicDir, requestPath);
    if (!filePath) {
      sendText(response, 400, "Bad Request", config);
      return;
    }
    let file = await fileExists(filePath, config);
    if (!file && config.directoryIndex) {
      const directoryResult = await resolveDirectoryRequest(
        request,
        response,
        filePath,
        requestPath,
        config,
      );
      if (directoryResult.handled) return;
      file = directoryResult.file;
    }
    if (!file) {
      await sendError(response, 404, "Not Found", config, config.notFoundFile);
      return;
    }

    await sendFile(response, request, file, config);
  };
}

async function resolveDirectoryRequest(
  request,
  response,
  filePath,
  requestPath,
  config,
) {
  try {
    const resolvedPublicDir = await fs.realpath(config.publicDir);
    const resolvedPath = await fs.realpath(filePath);
    if (!resolvedPath.startsWith(path.resolve(resolvedPublicDir) + path.sep)) {
      await sendError(response, 404, "Not Found", config, config.notFoundFile);
      return { handled: true };
    }
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) return { handled: false, file: null };
    if (requestPath !== "/" && !requestPath.endsWith("/")) {
      const requestUrl = new URL(request.url, "http://localhost");
      response.writeHead(config.directoryRedirect, {
        ...baseHeaders(config),
        Location: `${requestUrl.pathname}/${requestUrl.search}`,
      });
      response.end();
      return { handled: true };
    }
    const indexPath = path.join(resolvedPath, config.indexFile);
    const file = await fileExists(indexPath, config);
    if (file) return { handled: false, file };
    if (config.directoryListing) {
      await sendDirectoryListing(
        response,
        request,
        resolvedPath,
        requestPath,
        config,
      );
      return { handled: true };
    }
  } catch {
    /* missing/inaccessible path */
  }
  return { handled: false, file: null };
}

async function sendFile(response, request, file, config) {
  const { path: filePath, stats } = file;
  const rangeHeader = config.byteRanges ? request.headers?.range : null;
  const range = rangeHeader ? parseByteRange(rangeHeader, stats.size) : null;
  if (rangeHeader && !range) {
    sendText(response, 416, "Range Not Satisfiable", config, {
      "Content-Range": `bytes */${stats.size}`,
      "Accept-Ranges": "bytes",
    });
    return;
  }
  const headers = {
    ...fileHeaders(filePath, stats, config),
    ...(config.byteRanges ? { "Accept-Ranges": "bytes" } : {}),
  };
  if (request.method === "HEAD") {
    if (range) {
      headers["Content-Range"] =
        `bytes ${range.start}-${range.end}/${stats.size}`;
      headers["Content-Length"] = range.end - range.start + 1;
      response.writeHead(206, headers);
    } else {
      headers["Content-Length"] = stats.size;
      response.writeHead(200, headers);
    }
    response.end();
    return;
  }
  if (file.body && !range) {
    const encoded = await compressBody(
      file.body,
      request,
      headers["Content-Type"],
      config,
    );
    response.writeHead(200, {
      ...headers,
      "Content-Length": encoded.body.length,
      ...encoded.headers,
    });
    response.end(encoded.body);
    return;
  }
  streamFile(response, filePath, stats, range, config, fileHeaders, request);
}
