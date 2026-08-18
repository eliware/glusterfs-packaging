import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_PUBLIC_DIR,
  loadConfig,
  parseBoolean,
  parsePositiveInt,
} from "../../src/be/config.mjs";

describe("config parsing", () => {
  test("parses booleans case-insensitively and preserves fallback", () => {
    expect(parseBoolean(" YES ", false)).toBe(false);
    expect(parseBoolean("TRUE", false)).toBe(true);
    expect(parseBoolean("off", true)).toBe(false);
    expect(parseBoolean("unknown", true)).toBe(true);
  });

  test("accepts positive integers and falls back for invalid values", () => {
    expect(parsePositiveInt("123", 9)).toBe(123);
    expect(parsePositiveInt("0", 9)).toBe(9);
    expect(parsePositiveInt("-1", 9)).toBe(9);
    expect(parsePositiveInt("nope", 9)).toBe(9);
    expect(parsePositiveInt(undefined, 9)).toBe(9);
  });

  test("loads every documented environment option", () => {
    expect(
      loadConfig({
        HOST: "127.0.0.1",
        PORT: "9000",
        PUBLIC_DIR: "./site",
        INDEX_FILE: "home.html",
        DIRECTORY_INDEX: "false",
        DIRECTORY_REDIRECT: "308",
        ALLOW_DOTFILES: "true",
        ALLOW_SYMLINKS: "true",
        SECURITY_HEADERS: "false",
        CORS_ORIGIN: "https://example.test",
        ALLOW_GET: "false",
        ALLOW_HEAD: "false",
        BYTE_RANGES: "false",
        ETAG: "false",
        LAST_MODIFIED: "false",
        CACHE_CONTROL: "no-store",
        DEFAULT_MIME_TYPE: "text/plain",
        NOT_FOUND_FILE: "404.html",
        METHOD_NOT_ALLOWED_FILE: "405.html",
        ACCESS_LOG: "false",
        LOG_LEVEL: "debug",
        SHUTDOWN_TIMEOUT: "7000",
        REQUEST_TIMEOUT: "8000",
        HEADERS_TIMEOUT: "9000",
        KEEP_ALIVE_TIMEOUT: "10000",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 9000,
      publicDir: expect.stringMatching(/[/\\]site$/),
      blogDir: expect.stringMatching(/[/\\]site[/\\]blogs$/),
      staticDir: expect.stringMatching(/[/\\]site$/),
      staticIndexFile: "index.html",
      indexFile: "home.html",
      directoryIndex: false,
      directoryListing: true,
      directoryTemplate: "/srv/repository/directory-listing.html",
      directoryRedirect: 308,
      allowDotfiles: true,
      allowSymlinks: true,
      securityHeaders: false,
      structuredLogs: true,
      corsOrigin: "https://example.test",
      allowGet: false,
      allowHead: false,
      byteRanges: false,
      etag: false,
      lastModified: false,
      cacheControl: "no-store",
      compression: true,
      compressionMinBytes: 256,
      defaultMimeType: "text/plain",
      notFoundFile: "404.html",
      methodNotAllowedFile: "405.html",
      accessLog: false,
      logLevel: "debug",
      shutdownTimeout: 7000,
      requestTimeout: 8000,
      headersTimeout: 9000,
      keepAliveTimeout: 10000,
      ramCache: false,
      ramCachePaths: [
        "/index.html",
        "/directory-listing.html",
        "/web/app.css",
        "/web/app.js",
        "/assets/favicon.ico",
        "/assets/gluster-logo.webp",
      ],
      ramCacheMaxBytes: 10 * 1024 * 1024,
    });
  });

  test("uses safe defaults and validates constrained values", () => {
    const config = loadConfig({
      PORT: "invalid",
      DIRECTORY_REDIRECT: "302",
      SHUTDOWN_TIMEOUT: "0",
      REQUEST_TIMEOUT: "-1",
    });

    expect(config).toMatchObject({
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      publicDir: DEFAULT_PUBLIC_DIR,
      directoryRedirect: 301,
      shutdownTimeout: 5000,
      requestTimeout: 30000,
      headersTimeout: 60000,
      keepAliveTimeout: 5000,
    });
  });
});
