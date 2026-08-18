import {
  METADATA_VERSION,
  assertMetadataDocument,
  assertMetadataVersion,
  withMetadataVersion,
} from "../scripts/metadata-version.mjs";

test("metadata writers emit exactly the current version", () => {
  expect(withMetadataVersion({ schema: 1 })).toEqual({
    schema: 1,
    metadata_version: METADATA_VERSION,
  });
});

test("legacy and unknown metadata versions are rejected", () => {
  expect(() =>
    assertMetadataVersion({ meta_version: "0.1.0" }, "record"),
  ).toThrow(/legacy meta_version/);
  expect(() =>
    assertMetadataVersion({ metadata_version: "0.0.1" }, "record"),
  ).toThrow(/unsupported/);
  expect(() => withMetadataVersion({ metadata_version: "0.0.1" })).toThrow(
    /unsupported/,
  );
});

test("required metadata fields cannot be absent or empty", () => {
  expect(() =>
    assertMetadataDocument({ metadata_version: METADATA_VERSION }, "record", [
      "schema",
    ]),
  ).toThrow(/schema/);
  expect(() =>
    assertMetadataDocument(
      { metadata_version: METADATA_VERSION, schema: "" },
      "record",
      ["schema"],
    ),
  ).toThrow(/schema/);
});
