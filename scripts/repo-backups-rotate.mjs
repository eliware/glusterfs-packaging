#!/usr/bin/env node
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

const root = "/var/shared/backups/repo-backups";
const retention = 7;

await mkdir(root, { recursive: true });
await rm(path.join(root, String(retention)), { recursive: true, force: true });
for (let generation = retention - 1; generation >= 1; generation -= 1) {
  try {
    await rename(
      path.join(root, String(generation)),
      path.join(root, String(generation + 1)),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await mkdir(path.join(root, "1"), { recursive: true });
