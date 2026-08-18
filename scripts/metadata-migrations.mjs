import { pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { PACKAGE_VERSION } from "./package-version.mjs";

const migrationsDirectory = path.resolve(import.meta.dirname, "../migrations");

function parseVersion(value) {
  const match = String(value).match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/,
  );
  if (!match) throw new Error(`invalid package version: ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const key of ["major", "minor", "patch"])
    if (a[key] !== b[key]) return a[key] - b[key];
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

async function availableMigrations() {
  const names = await readdir(migrationsDirectory).catch(() => []);
  return names
    .map((name) => {
      const match = name.match(/^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?\.mjs$/);
      return match ? { name, version: match[1] } : null;
    })
    .filter(Boolean)
    .sort((left, right) => compareVersions(left.version, right.version));
}

export async function migrateMetadata(value, label = "metadata document") {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} metadata document must be an object`);
  if (Object.hasOwn(value, "meta_version"))
    throw new Error(`${label} uses legacy meta_version`);
  if (typeof value.metadata_version !== "string")
    throw new Error(`${label} metadata version is missing`);
  if (compareVersions(value.metadata_version, PACKAGE_VERSION) > 0)
    throw new Error(
      `${label} metadata version ${value.metadata_version} is newer than package version ${PACKAGE_VERSION}`,
    );

  let document = { ...value };
  let changed = false;
  for (const migration of await availableMigrations()) {
    if (
      compareVersions(migration.version, value.metadata_version) <= 0 ||
      compareVersions(migration.version, PACKAGE_VERSION) > 0
    )
      continue;
    const module = await import(
      pathToFileURL(path.join(migrationsDirectory, migration.name)).href
    );
    if (typeof module.migrate !== "function")
      throw new Error(`migration ${migration.name} does not export migrate()`);
    document = await module.migrate(document);
    if (!document || typeof document !== "object" || Array.isArray(document))
      throw new Error(
        `migration ${migration.name} returned an invalid document`,
      );
    document = { ...document, metadata_version: migration.version };
    changed = true;
  }
  return { document, changed };
}
