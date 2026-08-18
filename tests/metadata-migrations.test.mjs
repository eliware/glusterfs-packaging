import { migrateMetadata } from "../scripts/metadata-migrations.mjs";
import { METADATA_VERSION } from "../scripts/metadata-version.mjs";

test("application-only releases do not advance the persisted marker", async () => {
  const source = { metadata_version: METADATA_VERSION, schema: 1, value: "unchanged" };
  const result = await migrateMetadata(source);
  expect(result).toEqual({ document: source, changed: false });
});

test("new metadata uses the latest schema marker rather than package version", () => {
  expect(METADATA_VERSION).toBe("0.1.0");
});
