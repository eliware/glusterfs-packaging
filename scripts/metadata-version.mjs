import { PACKAGE_VERSION } from "./package-version.mjs";

export const METADATA_VERSION = PACKAGE_VERSION;

export function withMetadataVersion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("metadata document must be an object");
  if (Object.hasOwn(value, "meta_version"))
    throw new Error("metadata document uses legacy meta_version");
  if (
    Object.hasOwn(value, "metadata_version") &&
    value.metadata_version !== METADATA_VERSION
  )
    throw new Error(
      `metadata version ${String(value.metadata_version)} is unsupported; expected ${METADATA_VERSION}`,
    );
  return { ...value, metadata_version: METADATA_VERSION };
}

export function assertMetadataDocument(value, label, required = []) {
  assertMetadataVersion(value, label);
  for (const field of required) {
    if (
      !Object.hasOwn(value, field) ||
      value[field] === null ||
      value[field] === ""
    )
      throw new Error(`${label} is missing required field: ${field}`);
  }
  return value;
}

export function assertMetadataVersion(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} metadata document must be an object`);
  if (Object.hasOwn(value, "meta_version"))
    throw new Error(`${label} uses legacy meta_version`);
  if (value.metadata_version !== METADATA_VERSION)
    throw new Error(
      `${label} metadata version ${String(value.metadata_version)} is unsupported; expected ${METADATA_VERSION}`,
    );
  return value;
}
