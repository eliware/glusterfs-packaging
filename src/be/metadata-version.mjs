import { APP_VERSION } from "./app-version.mjs";

export const SUPPORTED_METADATA_VERSION = APP_VERSION;

export function assertMetadataVersion(value, label) {
  if (value?.metadata_version !== SUPPORTED_METADATA_VERSION)
    throw new Error(
      `${label} metadata version ${value?.metadata_version || "missing"} is unsupported`,
    );
  return value;
}
