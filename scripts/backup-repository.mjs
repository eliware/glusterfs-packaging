#!/usr/bin/env node
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env, run } from "./lib.mjs";

const repositoryRoot = env(
  "GLUSTER_REPOSITORY_ROOT",
  "/mnt/pvc/gluster-repository-http",
);
const backupRoot = env("REPO_BACKUP_ROOT", "/repo-backups");
const remote = env("REPO_BACKUP_REMOTE");
if (!remote)
  throw new Error(
    "REPO_BACKUP_REMOTE must be configured outside the repository",
  );
const retention = Number(env("REPO_BACKUP_RETENTION", "7"));
const attempts = Number(env("REPO_BACKUP_ATTEMPTS", "5"));
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const retry = async (label, command, args) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run(command, args);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delay = Math.min(30000, attempt * 5000);
      console.error(
        `[repo-backup] retry ${label} attempt=${attempt}/${attempts} wait=${Math.ceil(delay / 1000)}s`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
};

if (!Number.isInteger(retention) || retention < 1)
  throw new Error("REPO_BACKUP_RETENTION must be a positive integer");

const numberedDirectories = async (root) =>
  (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((a, b) => a - b);

const rotate = async (root) => {
  await mkdir(root, { recursive: true });
  await rm(path.join(root, String(retention)), {
    recursive: true,
    force: true,
  });
  for (let generation = retention - 1; generation >= 1; generation -= 1) {
    const source = path.join(root, String(generation));
    const destination = path.join(root, String(generation + 1));
    try {
      await rename(source, destination);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
};

const staging = path.join(
  backupRoot,
  `.staging-${process.pid}-${randomUUID()}`,
);
await mkdir(staging, { recursive: true });
try {
  // This file belongs only to backup generations.  Never leave it in the
  // published repository, even if an older run copied it there accidentally.
  await rm(path.join(repositoryRoot, "BACKUP-MANIFEST.txt"), {
    force: true,
  });
  await retry("local rsync", "rsync", [
    "--archive",
    "--hard-links",
    "--delete",
    "--numeric-ids",
    "--exclude",
    "BACKUP-MANIFEST.txt",
    `${repositoryRoot}/`,
    `${staging}/`,
  ]);
  await writeFile(
    path.join(staging, "BACKUP-MANIFEST.txt"),
    [
      "GlusterFS published repository backup",
      `created_at=${new Date().toISOString()}`,
      `source=${repositoryRoot}`,
      `hostname=${env("HOSTNAME", "unknown")}`,
      "",
    ].join("\n"),
  );

  await rotate(backupRoot);
  await rename(staging, path.join(backupRoot, "1"));
  await retry("remote rotation", "ssh", [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    remote.split(":")[0],
    "node /usr/local/sbin/repo-backups-rotate.mjs",
  ]);
  await retry("remote rsync", "rsync", [
    "--archive",
    "--hard-links",
    "--delete",
    "--numeric-ids",
    `${backupRoot}/1/`,
    `${remote}/1/`,
  ]);
  const localGenerations = await numberedDirectories(backupRoot);
  console.log(
    `[repo-backup] completed generation 1; local generations ${localGenerations.join(", ")}`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
