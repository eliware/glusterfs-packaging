#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { env, runInteractive } from "./lib.mjs";
import { withMetadataVersion } from "./metadata-version.mjs";

const options = new Map();
const repeated = (name) => {
  const values = [];
  for (let index = 2; index < process.argv.length; index += 1)
    if (process.argv[index] === `--${name}`)
      values.push([process.argv[index + 1], process.argv[index + 2]]);
  return values;
};
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index].startsWith("--")) {
    options.set(process.argv[index].slice(2), process.argv[index + 1]);
    index += 1;
  }
}
const outputDir = options.get("output-dir");
const recordFile = options.get("record-json");
if (!outputDir || !recordFile)
  throw new Error(
    "usage: write-provenance.mjs --output-dir DIR --record-json FILE",
  );

const record = JSON.parse(await readFile(recordFile, "utf8"));
const files = [];
const hashFile = async (file) => {
  const hash = createHash("sha256");
  const contents = await readFile(file);
  hash.update(contents);
  return { sha256: hash.digest("hex"), size: contents.byteLength };
};
const addFile = async (label, file, publicPath = label) => {
  const info = await stat(file);
  if (!info.isFile()) throw new Error(`${label} is not a file: ${file}`);
  files.push({ label, path: publicPath, ...(await hashFile(file)) });
};
const walk = async (directory, prefix) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file, `${prefix}/${entry.name}`);
    else if (entry.isFile())
      await addFile(`${prefix}/${entry.name}`, file, `${prefix}/${entry.name}`);
    else throw new Error(`provenance tree contains unsupported entry: ${file}`);
  }
};
const walkRoot = async (directory, prefix = "") => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walkRoot(file, relative);
    else if (entry.isFile()) await addFile(relative, file, relative);
    else throw new Error(`provenance tree contains unsupported entry: ${file}`);
  }
};

for (const [label, file] of repeated("asset")) {
  if (!label || !file) throw new Error("--asset requires LABEL FILE");
  const destination = path.join(outputDir, "assets", path.basename(file));
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(file, destination);
  await addFile(label, destination, `assets/${path.basename(file)}`);
}
for (const [label, directory] of repeated("tree")) {
  if (!label || !directory) throw new Error("--tree requires LABEL DIRECTORY");
  await walk(directory, label);
}
for (const directory of process.argv
  .map((value, index) =>
    value === "--tree-root" ? process.argv[index + 1] : null,
  )
  .filter(Boolean)) {
  await walkRoot(directory);
}

files.sort((left, right) => left.path.localeCompare(right.path));
const checksums = `${files.map((file) => `${file.sha256}  ${file.path}`).join("\n")}\n`;
const checksumHash = createHash("sha256").update(checksums).digest("hex");
const generated = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const provenance = withMetadataVersion({
  schema: 1,
  generated,
  record,
  files,
  checksums_sha256: checksumHash,
});
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "checksums.sha256"), checksums);
const provenanceFile = path.join(outputDir, "provenance.json");
await writeFile(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`);

const key = env(
  "PROVENANCE_SIGNING_KEY",
  env(
    "RELEASE_MANIFEST_SIGNING_KEY",
    env("RPM_SIGNING_KEY", env("APT_SIGNING_KEY")),
  ),
);
if (!key) {
  if (env("PROVENANCE_ALLOW_UNSIGNED", "0") !== "1")
    throw new Error(
      "set PROVENANCE_SIGNING_KEY or explicitly allow unsigned provenance",
    );
  console.warn("Writing explicitly unsigned provenance");
} else {
  const signingEnv = { ...process.env };
  delete signingEnv.GPG_TTY;
  const passphrase = env(
    "PROVENANCE_PASSPHRASE_FILE",
    env(
      "RELEASE_MANIFEST_PASSPHRASE_FILE",
      env("RPM_SIGNING_PASSPHRASE_FILE", env("APT_SIGNING_PASSPHRASE_FILE")),
    ),
  );
  await runInteractive(
    "gpg",
    [
      "--batch",
      "--yes",
      "--no-tty",
      "--armor",
      "--detach-sign",
      "--local-user",
      key,
      ...(passphrase
        ? ["--pinentry-mode", "loopback", "--passphrase-file", passphrase]
        : ["--pinentry-mode", "loopback"]),
      "--output",
      `${provenanceFile}.asc`,
      provenanceFile,
    ],
    { env: signingEnv },
  );
}
console.log(
  `Wrote provenance record with ${files.length} files to ${outputDir}`,
);
