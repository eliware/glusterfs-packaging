#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env, runInteractive } from "./lib.mjs";
import { readMetadata, writeMetadata } from "./metadata-io.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1)
  if (process.argv[index].startsWith("--"))
    args.set(process.argv[index].slice(2), process.argv[++index]);
const root = args.get("root");
const generation = args.get("generation") || "unknown";
if (!root) throw new Error("missing --root");
const indexFile = path.join(root, "metadata/repository-index.json");
const catalogFile = path.join(root, "metadata/catalog.json");
const [indexText, catalogText] = await Promise.all([
  readFile(indexFile, "utf8"),
  readFile(catalogFile, "utf8"),
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const index = await readMetadata(indexFile, { required: ["schema"] });
const catalog = await readMetadata(catalogFile, { required: ["schema"] });
const artifacts = Object.values(index.directories || {})
  .flatMap((directory) => directory.entries || [])
  .filter((entry) => entry.type === "file")
  .map((entry) => ({
    path: entry.href,
    size: entry.size,
    modified: entry.modified,
    sha256: entry.sha256,
    ...(entry.package ? { package: entry.package } : {}),
  }));
const manifest = {
  schema: 1,
  generation,
  generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  catalog_sha256: sha256(catalogText),
  repository_index_sha256: sha256(indexText),
  artifacts,
  images: catalog.images || [],
};
const manifestFile = path.join(root, "metadata/release-manifest.json");
await writeMetadata(manifestFile, manifest, {
  atomic: true,
  required: [
    "schema",
    "generation",
    "catalog_sha256",
    "repository_index_sha256",
  ],
});

const key = env(
  "RELEASE_MANIFEST_SIGNING_KEY",
  env("RPM_SIGNING_KEY", env("APT_SIGNING_KEY")),
);
if (!key) {
  if (env("RELEASE_MANIFEST_ALLOW_UNSIGNED", "0") !== "1")
    throw new Error(
      "set RELEASE_MANIFEST_SIGNING_KEY, RPM_SIGNING_KEY, or APT_SIGNING_KEY",
    );
  console.warn("Writing an explicitly unsigned seed manifest");
  process.exit(0);
}
const passphrase = env(
  "RELEASE_MANIFEST_PASSPHRASE_FILE",
  env("RPM_SIGNING_PASSPHRASE_FILE", env("APT_SIGNING_PASSPHRASE_FILE")),
);
const signingEnv = { ...process.env };
delete signingEnv.GPG_TTY;
await runInteractive(
  "gpg",
  [
    "--batch",
    "--yes",
    "--armor",
    "--detach-sign",
    "--local-user",
    key,
    ...(passphrase
      ? ["--pinentry-mode", "loopback", "--passphrase-file", passphrase]
      : []),
    "--output",
    `${manifestFile}.asc`,
    manifestFile,
  ],
  { env: signingEnv },
);
console.log(`Wrote signed release manifest for generation ${generation}`);
