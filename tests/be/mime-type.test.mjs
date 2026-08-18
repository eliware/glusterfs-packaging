import { describe, expect, test } from "@jest/globals";
import { getContentType } from "../../src/be/mime-type.mjs";

describe("getContentType", () => {
  test("maps known extensions", () => {
    expect(getContentType("/tmp/index.html")).toBe("text/html; charset=utf-8");
    expect(getContentType("/tmp/app.css")).toBe("text/css; charset=utf-8");
    expect(getContentType("/tmp/app.js")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(getContentType("/tmp/icon.png")).toBe("image/png");
    expect(getContentType("/tmp/movie.mp4")).toBe("video/mp4");
  });

  test("defaults to octet-stream", () => {
    expect(getContentType("/tmp/file.bin")).toBe("application/octet-stream");
  });

  test("defaults to octet-stream for files with no extension", () => {
    expect(getContentType("/tmp/file")).toBe("application/octet-stream");
  });
});
