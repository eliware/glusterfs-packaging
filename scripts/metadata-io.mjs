import { readFile, writeFile } from "node:fs/promises";
import { atomicWrite } from "./lib.mjs";
import { parseJson, stringifyJson } from "./serialization.mjs";
import {
  assertMetadataDocument,
  withMetadataVersion,
} from "./metadata-version.mjs";
import { migrateMetadata } from "./metadata-migrations.mjs";

export async function readMetadata(
  file,
  { label = file, required = [], allowMissing = false } = {},
) {
  try {
    const value = parseJson(await readFile(file, "utf8"), label);
    const migrated = await migrateMetadata(value, label);
    const document = assertMetadataDocument(migrated.document, label, required);
    if (migrated.changed) await atomicWrite(file, stringifyJson(document));
    return document;
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeMetadata(
  file,
  value,
  { atomic = false, required = [] } = {},
) {
  const document = assertMetadataDocument(
    withMetadataVersion(value),
    file,
    required,
  );
  const contents = stringifyJson(document);
  if (atomic) await atomicWrite(file, contents);
  else await writeFile(file, contents);
  return document;
}
