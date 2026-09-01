#!/usr/bin/env node
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";

const MANIFEST_NAME = ".candidate-manifest.json";
const READY_NAME = ".candidate-ready.json";
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const argument = (name, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const digestBuffer = (contents) =>
  crypto.createHash("sha256").update(contents).digest("hex");

async function durableWrite(file, contents) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temporary, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}

async function walkFiles(root, current = root, output = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === MANIFEST_NAME || entry.name === READY_NAME) continue;
    const file = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(root, file, output);
      continue;
    }
    if (!entry.isFile())
      throw new Error(`candidate contains unsupported entry: ${file}`);
    const relative = path.relative(root, file).split(path.sep).join("/");
    const contents = await readFile(file);
    output.push({
      path: relative,
      bytes: contents.byteLength,
      sha256: digestBuffer(contents),
    });
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

export async function writeCandidateManifest({ candidateDir, packageDir }) {
  const candidate = path.resolve(candidateDir);
  const packages = path.resolve(packageDir);
  await mkdir(candidate, { recursive: true });
  const relativePackageDir = path.relative(candidate, packages) || ".";
  const entries = await walkFiles(packages);
  const manifest = {
    schema: 1,
    generated: new Date().toISOString(),
    package_dir: relativePackageDir.split(path.sep).join("/"),
    files: entries,
  };
  const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = path.join(candidate, MANIFEST_NAME);
  const readyPath = path.join(candidate, READY_NAME);
  await rm(readyPath, { force: true });
  await durableWrite(manifestPath, manifestContents);
  await durableWrite(
    readyPath,
    `${JSON.stringify(
      {
        schema: 1,
        manifest: MANIFEST_NAME,
        manifest_sha256: digestBuffer(Buffer.from(manifestContents)),
        file_count: entries.length,
      },
      null,
      2,
    )}\n`,
  );
  return { manifest, manifestPath, readyPath };
}

async function verifyCandidateOnce({ candidateDir, packageDir }) {
  const candidate = path.resolve(candidateDir);
  const packages = path.resolve(packageDir);
  const readyPath = path.join(candidate, READY_NAME);
  const ready = JSON.parse(await readFile(readyPath, "utf8"));
  const manifestPath = path.join(candidate, ready.manifest || MANIFEST_NAME);
  const manifestContents = await readFile(manifestPath);
  if (digestBuffer(manifestContents) !== ready.manifest_sha256)
    throw new Error("candidate manifest hash is not stable");
  const manifest = JSON.parse(manifestContents.toString("utf8"));
  const expectedPackageDir = path.resolve(candidate, manifest.package_dir);
  if (expectedPackageDir !== packages)
    throw new Error(
      `candidate package directory mismatch: expected ${expectedPackageDir}, got ${packages}`,
    );
  if (manifest.files.length !== ready.file_count)
    throw new Error("candidate file count does not match its ready marker");
  for (const entry of manifest.files) {
    const file = path.resolve(packages, entry.path);
    if (file !== packages && !file.startsWith(`${packages}${path.sep}`))
      throw new Error(`candidate manifest path escapes package directory: ${entry.path}`);
    const information = await lstat(file);
    if (!information.isFile())
      throw new Error(`candidate file is missing: ${entry.path}`);
    if (information.size !== entry.bytes)
      throw new Error(`candidate file size changed: ${entry.path}`);
    const contents = await readFile(file);
    if (digestBuffer(contents) !== entry.sha256)
      throw new Error(`candidate file hash changed: ${entry.path}`);
  }
  return manifest;
}

export async function waitForCandidate({
  candidateDir,
  packageDir,
  timeoutMs = 120000,
  intervalMs = 2000,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const manifest = await verifyCandidateOnce({ candidateDir, packageDir });
      return manifest;
    } catch (error) {
      lastError = error;
      await sleep(Math.min(intervalMs, Math.max(100, deadline - Date.now())));
    }
  }
  throw new Error(
    `candidate was not ready after ${Math.ceil(timeoutMs / 1000)}s: ${lastError?.message || lastError}`,
    { cause: lastError },
  );
}

async function main() {
  const candidateDir = argument("candidate-dir");
  const packageDir = argument("package-dir");
  if (!candidateDir || !packageDir)
    throw new Error("--candidate-dir and --package-dir are required");
  if (process.argv.includes("--write")) {
    const result = await writeCandidateManifest({ candidateDir, packageDir });
    console.log(
      `candidate ready: ${result.manifest.files.length} files ${result.manifest.package_dir}`,
    );
    return;
  }
  if (process.argv.includes("--verify")) {
    const timeoutMs = Number(argument("timeout-seconds", "120")) * 1000;
    const manifest = await waitForCandidate({
      candidateDir,
      packageDir,
      timeoutMs,
    });
    console.log(`candidate verified: ${manifest.files.length} files`);
    return;
  }
  throw new Error("choose --write or --verify");
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
