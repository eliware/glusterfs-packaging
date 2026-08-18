import path from "node:path";
import { describe, expect, test } from "@jest/globals";
import { getRequestPath, resolvePublicPath } from "../../src/be/path-utils.mjs";

describe("getRequestPath", () => {
  test("removes query string and decodes the pathname", () => {
    expect(getRequestPath("/docs/My%20File.txt?hello=world")).toBe(
      "/docs/My File.txt",
    );
  });
});

describe("resolvePublicPath", () => {
  test("resolves root to index.html inside the public directory", () => {
    const publicDir = "/var/tmp/dev-web/public";
    expect(resolvePublicPath(publicDir, "/")).toBe(
      path.resolve(publicDir, "./index.html"),
    );
  });

  test("prevents path traversal outside the public directory", () => {
    const publicDir = "/var/tmp/dev-web/public";
    expect(resolvePublicPath(publicDir, "/../secret.txt")).toBeNull();
  });
});
