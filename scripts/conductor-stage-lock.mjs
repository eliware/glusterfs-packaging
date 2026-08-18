import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { env } from "./lib.mjs";
import { isoTimestamp, parseJson, stringifyJson } from "./serialization.mjs";

export function createLocalStageLock({ stateRoot, log }) {
  const queues = new Map();
  const withLocalStageLock = (stage, task) => {
    const previous = queues.get(stage) || Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        const stageLock = `${stateRoot}/local-${stage}.lock`;
        for (;;) {
          try {
            await mkdir(stageLock);
            break;
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
            let owner;
            try {
              owner = parseJson(
                await readFile(`${stageLock}/owner.json`, "utf8"),
                "conductor stage lock owner",
              );
              process.kill(owner.pid, 0);
            } catch (ownerError) {
              if (ownerError.code === "ESRCH" || ownerError.code === "ENOENT") {
                await rm(stageLock, { recursive: true, force: true });
                continue;
              }
              throw ownerError;
            }
            log(`${stage} lock waiting`, `pid=${owner.pid}`);
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                Number(env("CONDUCTOR_LOCAL_LOCK_WAIT_MS", "1000")),
              ),
            );
          }
        }
        await writeFile(
          `${stageLock}/owner.json`,
          stringifyJson({ pid: process.pid, stage, acquired: isoTimestamp() }),
        );
        try {
          return await task();
        } finally {
          await rm(stageLock, { recursive: true, force: true });
        }
      });
    queues.set(stage, operation);
    operation
      .finally(() => {
        if (queues.get(stage) === operation) queues.delete(stage);
      })
      .catch(() => {});
    return operation;
  };
  return withLocalStageLock;
}
