import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { env } from "./lib.mjs";

const staleAfterMs = Number(
  env("PUBLICATION_LOCK_STALE_MS", 6 * 60 * 60 * 1000),
);

export async function acquirePublicationLock(publishRoot) {
  const metadataDir = path.join(publishRoot, "metadata");
  const lockPath = path.join(metadataDir, "publication.lock");
  await mkdir(metadataDir, { recursive: true });
  const record = {
    id: randomUUID(),
    pid: process.pid,
    host: os.hostname(),
    started: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
      await handle.close();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8"));
          if (current.id === record.id) await rm(lockPath, { force: true });
        } catch {
          /* The lock was already removed or replaced. */
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST" || attempt > 0) throw error;
      let existing;
      try {
        existing = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        existing = null;
      }
      const startedAt = Date.parse(existing?.started || "");
      const localOwnerAlive =
        existing?.host === os.hostname() &&
        Number.isInteger(existing?.pid) &&
        (() => {
          try {
            process.kill(existing.pid, 0);
            return true;
          } catch {
            return false;
          }
        })();
      if (localOwnerAlive)
        throw new Error(
          `publication is locked${existing ? ` by ${existing.host}:${existing.pid}` : ""}`,
        );
      if (!Number.isFinite(startedAt) || Date.now() - startedAt < staleAfterMs)
        throw new Error(
          `publication is locked${existing ? ` by ${existing.host}:${existing.pid}` : ""}`,
        );
      await rm(lockPath, { force: true });
    }
  }
  throw new Error("unable to acquire publication lock");
}
