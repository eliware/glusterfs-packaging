#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { run } from "./lib.mjs";

const directory = process.argv[2];
if (!directory) throw new Error("usage: verify-provenance.mjs PROVENANCE_DIR");
const treeRoot = (() => {
  const index = process.argv.indexOf("--tree-root");
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : directory;
})();
const provenanceFile = path.join(directory, "provenance.json");
const checksumsFile = path.join(directory, "checksums.sha256");
const provenance = JSON.parse(await readFile(provenanceFile, "utf8"));
const checksums = await readFile(checksumsFile, "utf8");
const expected = new Map(
  checksums
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      if (!match) throw new Error(`invalid checksum line: ${line}`);
      return [match[2], match[1]];
    }),
);
for (const file of provenance.files || []) {
  // Package provenance is stored beside its record, while package payload
  // files may live in a nested RPM/DEB repository tree. Assets remain beside
  // the record and all other paths are resolved from the supplied tree root.
  const fileRoot = file.path.startsWith("assets/") ? directory : treeRoot;
  const filePath = path.join(fileRoot, file.path);
  const info = await stat(filePath);
  const digest = createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
  if (info.size !== file.size || digest !== file.sha256)
    throw new Error(`provenance hash mismatch: ${file.path}`);
  if (expected.get(file.path) !== digest)
    throw new Error(`checksum manifest mismatch: ${file.path}`);
}
const checksumHash = createHash("sha256").update(checksums).digest("hex");
if (checksumHash !== provenance.checksums_sha256)
  throw new Error("checksum manifest digest does not match provenance");
const signature = `${provenanceFile}.asc`;
try {
  await stat(signature);
  await run("gpg", ["--batch", "--verify", signature, provenanceFile]);
} catch (error) {
  if (process.env.ALLOW_UNSIGNED_PROVENANCE === "1")
    console.warn(`Signature verification skipped: ${error.message}`);
  else throw error;
}
console.log(`Verified provenance for ${provenance.record?.kind || "record"}`);
