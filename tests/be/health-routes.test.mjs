import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { once } from "node:events";
import { describe, expect, test } from "@jest/globals";
import {
  handleCatalogRoute,
  handleHealthRoute,
} from "../../src/be/health-routes.mjs";
import { SUPPORTED_METADATA_VERSION } from "../../src/be/metadata-version.mjs";

class MockResponse extends Writable {
  constructor(method = "GET") {
    super();
    this.req = { method };
    this.headers = {};
    this.statusCode = null;
    this.body = Buffer.alloc(0);
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  _write(chunk, encoding, callback) {
    this.body = Buffer.concat([this.body, Buffer.from(chunk)]);
    callback();
  }
}

async function responseFor(callback, method = "GET") {
  const response = new MockResponse(method);
  const finished = once(response, "finish");
  await callback(response);
  await finished;
  return response;
}

async function metadataFixture({ active = true } = {}) {
  const publicDir = await mkdtemp(path.join(os.tmpdir(), "health-routes-"));
  const metadataDir = path.join(publicDir, "metadata");
  await mkdir(metadataDir);
  const versioned = { metadata_version: SUPPORTED_METADATA_VERSION, schema: 1 };
  await writeFile(
    path.join(metadataDir, "catalog.json"),
    JSON.stringify({ ...versioned, releases: [] }),
  );
  await writeFile(
    path.join(metadataDir, "repository-index.json"),
    JSON.stringify({ ...versioned, entries: [] }),
  );
  if (active) {
    await writeFile(
      path.join(metadataDir, "active-generation.json"),
      JSON.stringify({ ...versioned, generation: "run-1" }),
    );
    await mkdir(path.join(publicDir, ".generations", "run-1"), {
      recursive: true,
    });
    await writeFile(
      path.join(publicDir, ".generations", "run-1", "generation.json"),
      JSON.stringify({ ...versioned, generation: "run-1" }),
    );
  }
  return { publicDir };
}

const configFor = (publicDir) => ({ publicDir, securityHeaders: true });

describe("health and catalog routes", () => {
  test("returns an uncached health response", async () => {
    const response = await responseFor((value) =>
      handleHealthRoute({ method: "GET" }, value, "/health", configFor("/tmp")),
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(JSON.parse(response.body).status).toBe("ok");
  });

  test("accepts the healthz alias", async () => {
    const response = await responseFor((value) =>
      handleHealthRoute(
        { method: "GET" },
        value,
        "/healthz",
        configFor("/tmp"),
      ),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });

  test("renders metrics for GET requests", async () => {
    const response = await responseFor((value) =>
      handleHealthRoute(
        { method: "GET" },
        value,
        "/metrics",
        configFor("/tmp"),
      ),
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toContain("text/plain");
    expect(response.body.toString()).toContain(
      "gluster_repository_http_requests_total",
    );
  });

  test("does not write a metrics body for HEAD requests", async () => {
    const response = await responseFor(
      (value) =>
        handleHealthRoute(
          { method: "HEAD" },
          value,
          "/metrics",
          configFor("/tmp"),
        ),
      "HEAD",
    );
    expect(response.statusCode).toBe(200);
    expect(response.body.length).toBe(0);
  });

  test("ignores unrelated health paths", async () => {
    const response = new MockResponse();
    await expect(
      handleHealthRoute(
        { method: "GET" },
        response,
        "/not-health",
        configFor("/tmp"),
      ),
    ).resolves.toBe(false);
  });

  test("reports readiness when all metadata is valid", async () => {
    const { publicDir } = await metadataFixture();
    const response = await responseFor((value) =>
      handleHealthRoute(
        { method: "GET" },
        value,
        "/ready",
        configFor(publicDir),
      ),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: "ready",
      generation: "run-1",
    });
  });

  test("accepts the readyz alias", async () => {
    const { publicDir } = await metadataFixture();
    const response = await responseFor((value) =>
      handleHealthRoute(
        { method: "GET" },
        value,
        "/readyz",
        configFor(publicDir),
      ),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe("ready");
  });

  test("reports not-ready when active generation metadata is absent", async () => {
    const { publicDir } = await metadataFixture({ active: false });
    const response = await responseFor((value) =>
      handleHealthRoute(
        { method: "GET" },
        value,
        "/ready",
        configFor(publicDir),
      ),
    );
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      status: "not-ready",
      generation: null,
    });
  });

  test("reports not-ready when the catalog version is invalid", async () => {
    const { publicDir } = await metadataFixture();
    await writeFile(
      path.join(publicDir, "metadata", "catalog.json"),
      JSON.stringify({ metadata_version: "9.9.9" }),
    );
    const response = await responseFor((value) =>
      handleHealthRoute(
        { method: "GET" },
        value,
        "/ready",
        configFor(publicDir),
      ),
    );
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).status).toBe("not-ready");
  });

  test("serves a versioned catalog", async () => {
    const { publicDir } = await metadataFixture();
    const response = await responseFor((value) =>
      handleCatalogRoute(value, "/api/v1/catalog", configFor(publicDir)),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).metadata_version).toBe(
      SUPPORTED_METADATA_VERSION,
    );
  });

  test("returns an unavailable response when the catalog is missing", async () => {
    const publicDir = await mkdtemp(path.join(os.tmpdir(), "catalog-missing-"));
    const response = await responseFor((value) =>
      handleCatalogRoute(value, "/api/v1/catalog", configFor(publicDir)),
    );
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ error: "catalog unavailable" });
  });
});
