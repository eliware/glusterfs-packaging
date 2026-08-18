import {
  compactTimestamp,
  dateStamp,
  isoTimestamp,
  parseJson,
  stringifyJson,
} from "../scripts/serialization.mjs";

const sampleDate = new Date("2026-08-18T01:02:03.456Z");

test("formats timestamps consistently", () => {
  expect(isoTimestamp(sampleDate)).toBe("2026-08-18T01:02:03Z");
  expect(compactTimestamp(sampleDate)).toBe("20260818010203456");
  expect(dateStamp(sampleDate)).toBe("2026.08.18");
});

test("serializes and parses JSON with a trailing newline", () => {
  const text = stringifyJson({ answer: 42 });
  expect(text).toBe('{\n  "answer": 42\n}\n');
  expect(parseJson(text, "sample")).toEqual({ answer: 42 });
});

test("adds context to invalid JSON errors", () => {
  expect(() => parseJson("{", "sample")).toThrow("sample:");
});
