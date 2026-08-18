#!/usr/bin/env node
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repoRoot, runInteractive } from "./lib.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index].startsWith("--"))
    args.set(process.argv[index].slice(2), process.argv[index + 1]);
}
const required = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
};
const outputDir = required("output-dir");
const packageRoot = required("package-root");
const recordFile =
  args.get("record-json") || path.join(outputDir, "provenance.json");
const format = required("format");
if (!["rpm", "deb"].includes(format))
  throw new Error(`unsupported format: ${format}`);
const suppliedAssets = [];
for (let index = 2; index < process.argv.length; index += 1)
  if (process.argv[index] === "--asset")
    suppliedAssets.push([process.argv[index + 1], process.argv[index + 2]]);

const stage = await mkdtemp(
  path.join(os.tmpdir(), "gluster-package-provenance-"),
);
try {
  const payload = path.join(stage, "payload");
  await cp(packageRoot, payload, { recursive: true });
  for (const name of [
    "assets",
    "provenance.json",
    "provenance.json.asc",
    "checksums.sha256",
    "validation.json",
    "container-validation.json",
  ])
    await rm(path.join(payload, name), { recursive: true, force: true });

  let recordPath = recordFile;
  if (
    recordFile.endsWith("/provenance.json") ||
    recordFile.endsWith("\\provenance.json")
  ) {
    const existing = JSON.parse(await readFile(recordFile, "utf8"));
    recordPath = path.join(stage, "record.json");
    await writeFile(
      recordPath,
      `${JSON.stringify(existing.record, null, 2)}\n`,
    );
  }

  const stagedAssets = path.join(stage, "assets");
  await mkdir(stagedAssets, { recursive: true });
  try {
    for (const name of await readdir(path.join(outputDir, "assets")))
      await cp(
        path.join(outputDir, "assets", name),
        path.join(stagedAssets, name),
      );
  } catch {}
  for (const [label, file] of suppliedAssets) {
    if (!label || !file) throw new Error("--asset requires LABEL FILE");
    await cp(file, path.join(stagedAssets, path.basename(file)));
  }

  const writerArgs = [
    path.join(repoRoot, "scripts/write-provenance.mjs"),
    "--output-dir",
    outputDir,
    "--record-json",
    recordPath,
    "--tree-root",
    payload,
  ];
  for (const [label, file] of suppliedAssets)
    writerArgs.push(
      "--asset",
      label,
      path.join(stagedAssets, path.basename(file)),
    );
  for (const name of await readdir(stagedAssets))
    if (!suppliedAssets.some(([, file]) => path.basename(file) === name))
      writerArgs.push("--asset", name, path.join(stagedAssets, name));
  await runInteractive("node", writerArgs, { env: process.env });
  console.log(`Rebuilt final ${format} package provenance in ${outputDir}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
