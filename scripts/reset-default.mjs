#!/usr/bin/env node
/*
 * Destructive recovery utility.
 *
 * This completely wipes the published repository contents, generated metadata,
 * conductor checkpoints, build workspaces, and dedicated worker ramdisks. It
 * preserves the six persistent lane ccache directories unless
 * RESET_CLEAR_CCACHE=1 is set. It preserves only the seed generation,
 * repository bootstrap file, and signing key in publication storage. It does
 * not delete source code, PVC objects, GHCR packages, or images.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { METADATA_VERSION, withMetadataVersion } from "./metadata-version.mjs";
import { promisify } from "node:util";

const repoRoot = path.resolve(import.meta.dirname, "..");
const requiredEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
};

if (!process.argv.includes("--force")) {
  console.error(
    "WARNING: reset-default completely wipes the published repository and all generated metadata.",
  );
  console.error(
    "It also wipes conductor checkpoints, build workspaces, and dedicated worker ramdisks.",
  );
  console.error(
    "Persistent lane ccaches are preserved unless RESET_CLEAR_CCACHE=1 is set.",
  );
  console.error(
    "This is irreversible. Re-run with --force only when you intend to reset everything.",
  );
  console.error("");
  console.error(
    "Required configuration is supplied through environment variables:",
  );
  console.error("  RESET_PUBLICATION_ROOT=/path/to/publication-root");
  console.error("  RESET_WORKSPACE_ROOT=/path/to/workspace-root");
  console.error("  RESET_CONDUCTOR_ROOT=/path/to/conductor-state");
  console.error("  RESET_WORKER_HOSTS=worker-a,worker-b,worker-c");
  console.error("  RESET_SSH_USER=operator");
  console.error("  RESET_WORKER_RAMDISK_ROOT=/path/to/ramdisk-build-root");
  console.error(
    "  RESET_CLEAR_CCACHE=1  # optional: also clear all six lane caches",
  );
  console.error("");
  console.error("Example:");
  console.error("  RESET_PUBLICATION_ROOT=/path/to/publication-root \\");
  console.error("  RESET_WORKSPACE_ROOT=/path/to/workspace-root \\");
  console.error("  RESET_CONDUCTOR_ROOT=/path/to/conductor-state \\");
  console.error("  RESET_WORKER_HOSTS=worker-a,worker-b,worker-c \\");
  console.error("  RESET_SSH_USER=operator \\");
  console.error("  RESET_WORKER_RAMDISK_ROOT=/path/to/ramdisk-build-root \\");
  console.error("  RESET_CLEAR_CCACHE=1 \\");
  console.error("  node scripts/reset-default.mjs --force");
  process.exit(2);
}

const exec = promisify(execFile);
const publicationRoot = requiredEnv("RESET_PUBLICATION_ROOT");
const workspaceRoot = requiredEnv("RESET_WORKSPACE_ROOT");
const conductorRoot = requiredEnv("RESET_CONDUCTOR_ROOT");
const workerHosts = requiredEnv("RESET_WORKER_HOSTS")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const workerSshUser = requiredEnv("RESET_SSH_USER");
const workerRamdiskRoot = requiredEnv("RESET_WORKER_RAMDISK_ROOT");
const clearCcache = process.env.RESET_CLEAR_CCACHE === "1";
const laneIds = new Set([
  "epel10-stable",
  "epel10-rolling",
  "debian-stable",
  "debian-rolling",
  "ubuntu-stable",
  "ubuntu-rolling",
]);

async function removeChildren(directory, keep = new Set()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!keep.has(entry.name))
      await rm(`${directory}/${entry.name}`, { recursive: true, force: true });
  }
}

async function copySeedMetadata(source, destination) {
  const value = JSON.parse(await readFile(source, "utf8"));
  await writeFile(
    destination,
    `${JSON.stringify(withMetadataVersion(value), null, 2)}\n`,
  );
}

await exec("systemctl", ["stop", "gluster-packaging.timer"]);
const active = await exec("systemctl", [
  "is-active",
  "gluster-packaging.service",
]).catch(() => ({ stdout: "inactive\n" }));
if (active.stdout.trim() === "active")
  throw new Error("conductor is active; stop it before using reset-default");

await removeChildren(`${publicationRoot}/.generations`, new Set(["seed"]));
await mkdir(`${publicationRoot}/.generations/seed`, { recursive: true });
await copySeedMetadata(
  `${repoRoot}/templates/generation.seed.json`,
  `${publicationRoot}/.generations/seed/generation.json`,
);
for (const name of ["el10", "debian", "ubuntu", "metadata"])
  await rm(`${publicationRoot}/${name}`, { recursive: true, force: true });
await mkdir(`${publicationRoot}/metadata`, { recursive: true });
await copySeedMetadata(
  `${repoRoot}/templates/catalog.seed.json`,
  `${publicationRoot}/metadata/catalog.json`,
);
await copySeedMetadata(
  `${repoRoot}/templates/active-generation.seed.json`,
  `${publicationRoot}/metadata/active-generation.json`,
);
await exec(process.execPath, [
  `${repoRoot}/scripts/generate-repository-index.mjs`,
  "--root",
  publicationRoot,
]);
await cp(
  `${repoRoot}/templates/glusterfs-el10.repo`,
  `${publicationRoot}/glusterfs-el10.repo`,
);
await cp(
  `${repoRoot}/artifacts/keys/RPM-GPG-KEY-ELIWARE-GLUSTER`,
  `${publicationRoot}/keys/RPM-GPG-KEY-ELIWARE-GLUSTER`,
);

const workspaceConductorRoot = `${workspaceRoot}/conductor`;
const workspaceLanesRoot = `${workspaceConductorRoot}/workspaces`;
await mkdir(workspaceLanesRoot, { recursive: true });
await removeChildren(workspaceRoot, new Set(["conductor"]));
await removeChildren(workspaceConductorRoot, new Set(["workspaces"]));
for (const entry of await readdir(workspaceLanesRoot, {
  withFileTypes: true,
})) {
  const laneRoot = `${workspaceLanesRoot}/${entry.name}`;
  if (!entry.isDirectory() || !laneIds.has(entry.name)) {
    await rm(laneRoot, { recursive: true, force: true });
    continue;
  }
  await removeChildren(laneRoot, clearCcache ? new Set() : new Set(["ccache"]));
}
await mkdir(conductorRoot, { recursive: true });
await removeChildren(conductorRoot);
await writeFile(
  `${conductorRoot}/state.json`,
  `${JSON.stringify({ metadata_version: METADATA_VERSION, schema: 1, checkpoints: {}, runs: [] }, null, 2)}\n`,
);

for (const host of workerHosts)
  await exec("ssh", [
    "-o",
    "BatchMode=yes",
    `${workerSshUser}@${host}`,
    `mkdir -p '${workerRamdiskRoot}' && find '${workerRamdiskRoot}' -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +`,
  ]);

await exec("systemctl", ["enable", "gluster-packaging.timer"]);
await exec("systemctl", ["reset-failed", "gluster-packaging.service"]);
console.log(
  `Default state restored; conductor remains stopped. Persistent lane ccache ${clearCcache ? "cleared" : "preserved"}.`,
);
