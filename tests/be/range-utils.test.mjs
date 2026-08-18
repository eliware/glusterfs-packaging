import { describe, expect, test } from "@jest/globals";
import { parseByteRange } from "../../src/be/range-utils.mjs";

describe("parseByteRange", () => {
  test("returns null for non-string headers and negative sizes", () => {
    expect(parseByteRange(undefined, 10)).toBeNull();
    expect(parseByteRange(null, 10)).toBeNull();
    expect(parseByteRange(123, 10)).toBeNull();
    expect(parseByteRange("bytes=0-1", -1)).toBeNull();
  });

  test("returns null for malformed range headers", () => {
    expect(parseByteRange("abc", 10)).toBeNull();
    expect(parseByteRange("bytes=", 10)).toBeNull();
    expect(parseByteRange("bytes=1-2-3", 10)).toBeNull();
  });

  test("returns null for empty ranges", () => {
    expect(parseByteRange("bytes=-", 10)).toBeNull();
  });

  test("returns null for invalid suffix ranges", () => {
    expect(parseByteRange("bytes=-0", 10)).toBeNull();
    expect(parseByteRange("bytes=-foo", 10)).toBeNull();
    expect(parseByteRange("bytes=-3.5", 10)).toBeNull();
    expect(parseByteRange("bytes=-3", 0)).toBeNull();
  });

  test("returns null for invalid start ranges", () => {
    expect(parseByteRange("bytes=10-", 10)).toBeNull();
    expect(parseByteRange("bytes=foo-3", 10)).toBeNull();
  });

  test("returns null for invalid end ranges", () => {
    expect(parseByteRange("bytes=3-2", 10)).toBeNull();
    expect(parseByteRange("bytes=3-foo", 10)).toBeNull();
    expect(parseByteRange("bytes=3-3.5", 10)).toBeNull();
  });

  test("parses open-ended and bounded ranges", () => {
    expect(parseByteRange("bytes=3-", 10)).toEqual({ start: 3, end: 9 });
    expect(parseByteRange("bytes=3-7", 10)).toEqual({ start: 3, end: 7 });
    expect(parseByteRange("bytes=3-999", 10)).toEqual({ start: 3, end: 9 });
  });

  test("parses suffix ranges", () => {
    expect(parseByteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange("bytes=-99", 10)).toEqual({ start: 0, end: 9 });
  });
});
