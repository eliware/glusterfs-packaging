import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { once } from "node:events";
import { describe, expect, test } from "@jest/globals";
import { createStaticRequestListener } from "../../src/be/static-file-server.mjs";

class MockResponse extends Writable {
  constructor() {
    super();
    this.headers = null;
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

async function makePublicDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dev-web-"));
  await writeFile(path.join(dir, "index.html"), "<h1>Hello</h1>");
  await writeFile(path.join(dir, "hello.txt"), "hello world");
  await writeFile(path.join(dir, "movie.mp4"), "0123456789");
  await mkdir(path.join(dir, "folder"));
  await mkdir(path.join(dir, "calc"));
  await writeFile(path.join(dir, "calc", "index.html"), "<h1>Calc</h1>");
  return dir;
}

async function runRequest(listener, request) {
  const response = new MockResponse();
  listener(request, response);
  await once(response, "finish");
  return response;
}

describe("createStaticRequestListener", () => {
  test("serves files from the public directory", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/hello.txt",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(response.body.toString()).toBe("hello world");
  });

  test("serves mp4 files with video content type", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/movie.mp4",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("video/mp4");
    expect(response.body.toString()).toBe("0123456789");
  });

  test("supports byte range requests for media seeking", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/movie.mp4",
      headers: { range: "bytes=2-5" },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["Accept-Ranges"]).toBe("bytes");
    expect(response.headers["Content-Range"]).toBe("bytes 2-5/10");
    expect(response.headers["Content-Length"]).toBe(4);
    expect(response.body.toString()).toBe("2345");
  });

  test("supports suffix byte ranges", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/movie.mp4",
      headers: { range: "bytes=-3" },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["Content-Range"]).toBe("bytes 7-9/10");
    expect(response.body.toString()).toBe("789");
  });

  test("serves index.html when the request url is empty", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, { method: "GET", url: "" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(response.body.toString()).toBe("<h1>Hello</h1>");
  });

  test("supports HEAD requests", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, { method: "HEAD", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(response.body.length).toBe(0);
  });

  test("supports HEAD range requests", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "HEAD",
      url: "/movie.mp4",
      headers: { range: "bytes=0-3" },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["Content-Range"]).toBe("bytes 0-3/10");
    expect(response.headers["Content-Length"]).toBe(4);
    expect(response.body.length).toBe(0);
  });

  test("rejects unsupported methods", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, { method: "POST", url: "/" });

    expect(response.statusCode).toBe(405);
    expect(response.body.toString()).toBe("Method Not Allowed");
  });

  test("rejects missing methods", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, { url: "/" });

    expect(response.statusCode).toBe(405);
    expect(response.body.toString()).toBe("Method Not Allowed");
  });

  test("returns 400 for malformed request URLs", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/%E0%A4%A",
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.toString()).toBe("Bad Request");
  });

  test("returns 400 for escaped paths", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/..%2fsecret.txt",
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.toString()).toBe("Bad Request");
  });

  test("renders a listing for a directory without index.html", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/folder/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(response.body.toString()).toContain("Index of /folder/");
  });

  test("returns 404 when stat fails for a missing path", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/missing/",
    });

    expect(response.statusCode).toBe(404);
    expect(response.body.toString()).toBe("Not Found");
  });

  test("does not serve files through symlinks outside the public directory", async () => {
    const publicDir = await makePublicDir();
    const outsideDir = await mkdtemp(
      path.join(os.tmpdir(), "dev-web-outside-"),
    );
    await writeFile(path.join(outsideDir, "secret.txt"), "secret");
    await symlink(
      path.join(outsideDir, "secret.txt"),
      path.join(publicDir, "secret.txt"),
    );
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/secret.txt",
    });

    expect(response.statusCode).toBe(404);
    expect(response.body.toString()).toBe("Not Found");
  });

  test("returns 404 for missing files", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/missing.txt",
    });

    expect(response.statusCode).toBe(404);
    expect(response.body.toString()).toBe("Not Found");
  });

  test("redirects directory paths without a trailing slash", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/calc?mode=test",
    });

    expect(response.statusCode).toBe(301);
    expect(response.headers.Location).toBe("/calc/?mode=test");
    expect(response.body.length).toBe(0);
  });

  test("serves index.html for directory paths with and without a trailing slash", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/calc/",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(response.body.toString()).toBe("<h1>Calc</h1>");
  });

  test("renders a listing for directories", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/folder/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(response.body.toString()).toContain("↥");
  });

  test("returns 416 for unsatisfiable ranges", async () => {
    const publicDir = await makePublicDir();
    const listener = createStaticRequestListener(publicDir);

    const response = await runRequest(listener, {
      method: "GET",
      url: "/movie.mp4",
      headers: { range: "bytes=100-200" },
    });

    expect(response.statusCode).toBe(416);
    expect(response.headers["Content-Range"]).toBe("bytes */10");
    expect(response.body.toString()).toBe("Range Not Satisfiable");
  });
});
