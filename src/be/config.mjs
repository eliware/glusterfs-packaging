import path from "node:path";

export const DEFAULT_PORT = 8000;
export const DEFAULT_HOST = "0.0.0.0";
export const DEFAULT_PUBLIC_DIR = path.resolve(process.cwd(), "public");

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);

export function parseBoolean(value, fallback) {
  if (TRUE.has(String(value).toLowerCase())) return true;
  if (FALSE.has(String(value).toLowerCase())) return false;
  return fallback;
}

export function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function envValue(env, key, fallback = "") {
  const value = env[key];
  return typeof value === "string" ? value : fallback;
}

export function loadConfig(env = process.env) {
  const publicDir = path.resolve(
    envValue(env, "PUBLIC_DIR", DEFAULT_PUBLIC_DIR),
  );
  const host = envValue(env, "HOST", DEFAULT_HOST);
  const portText = envValue(env, "PORT");
  const directoryRedirect = envValue(env, "DIRECTORY_REDIRECT");

  return {
    host,
    port: parsePositiveInt(portText, DEFAULT_PORT),
    publicDir,
    blogDir: path.resolve(
      envValue(env, "BLOG_DIR", path.join(publicDir, "blogs")),
    ),
    staticDir: path.resolve(
      envValue(env, "STATIC_DIR", path.join(process.cwd(), "site")),
    ),
    staticIndexFile: envValue(env, "STATIC_INDEX_FILE", "index.html"),
    indexFile: envValue(env, "INDEX_FILE", "index.html"),
    directoryIndex: parseBoolean(envValue(env, "DIRECTORY_INDEX"), true),
    directoryListing: parseBoolean(
      envValue(env, "DIRECTORY_LISTING", "true"),
      true,
    ),
    directoryTemplate: envValue(
      env,
      "DIRECTORY_TEMPLATE",
      "/srv/repository/directory-listing.html",
    ),
    directoryRedirect: ["301", "308"].includes(directoryRedirect)
      ? Number(directoryRedirect)
      : 301,
    allowDotfiles: parseBoolean(
      envValue(env, "ALLOW_DOTFILES", "false"),
      false,
    ),
    allowSymlinks: parseBoolean(
      envValue(env, "ALLOW_SYMLINKS", "false"),
      false,
    ),
    securityHeaders: parseBoolean(
      envValue(env, "SECURITY_HEADERS", "true"),
      true,
    ),
    corsOrigin: envValue(env, "CORS_ORIGIN", "") || "",
    allowGet: parseBoolean(envValue(env, "ALLOW_GET", "true"), true),
    allowHead: parseBoolean(envValue(env, "ALLOW_HEAD", "true"), true),
    byteRanges: parseBoolean(envValue(env, "BYTE_RANGES", "true"), true),
    etag: parseBoolean(envValue(env, "ETAG", "true"), true),
    lastModified: parseBoolean(envValue(env, "LAST_MODIFIED", "true"), true),
    cacheControl: envValue(env, "CACHE_CONTROL", "") || "",
    defaultMimeType:
      envValue(env, "DEFAULT_MIME_TYPE", "application/octet-stream") ||
      "application/octet-stream",
    notFoundFile: envValue(env, "NOT_FOUND_FILE", "") || "",
    methodNotAllowedFile: envValue(env, "METHOD_NOT_ALLOWED_FILE", "") || "",
    accessLog: parseBoolean(envValue(env, "ACCESS_LOG", "true"), true),
    structuredLogs: parseBoolean(
      envValue(env, "STRUCTURED_LOGS", "true"),
      true,
    ),
    logLevel: envValue(env, "LOG_LEVEL", "info") || "info",
    shutdownTimeout: parsePositiveInt(envValue(env, "SHUTDOWN_TIMEOUT"), 5000),
    requestTimeout: parsePositiveInt(envValue(env, "REQUEST_TIMEOUT"), 30000),
    headersTimeout: parsePositiveInt(envValue(env, "HEADERS_TIMEOUT"), 60000),
    keepAliveTimeout: parsePositiveInt(
      envValue(env, "KEEP_ALIVE_TIMEOUT"),
      5000,
    ),
    ramCache: parseBoolean(envValue(env, "RAM_CACHE", "false"), false),
    ramCachePaths: envValue(
      env,
      "RAM_CACHE_PATHS",
      "/index.html,/directory-listing.html,/web/app.css,/web/app.js,/assets/favicon.ico,/assets/gluster-logo.webp",
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    ramCacheMaxBytes: parsePositiveInt(
      envValue(env, "RAM_CACHE_MAX_BYTES"),
      10 * 1024 * 1024,
    ),
    compression: parseBoolean(envValue(env, "COMPRESSION", "true"), true),
    compressionMinBytes: parsePositiveInt(
      envValue(env, "COMPRESSION_MIN_BYTES"),
      256,
    ),
  };
}
