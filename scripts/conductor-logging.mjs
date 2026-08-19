import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  compareStatusReports,
  createStatusDocument,
  filterDisplayedStatusReports,
  formatStatusLine,
} from "./conductor-status.mjs";

export function createConductorStatus({ directory, runId, log }) {
  let reporter;
  const report = async () => {
    let reports = [];
    try {
      reports = await Promise.all(
        (await readdir(directory))
          .filter((name) => name.endsWith(".json"))
          .map(async (name) => {
            const value = JSON.parse(
              await readFile(path.join(directory, name), "utf8"),
            );
            if (value.log_file) {
              try {
                const contents = await readFile(value.log_file, "utf8");
                value.log = `${contents.split(/\r?\n/).filter(Boolean).length}`;
              } catch {}
            }
            return value;
          }),
      );
    } catch {
      return;
    }
    reports = filterDisplayedStatusReports(reports).sort(compareStatusReports);
    if (!reports.length) return;
    log("status report");
    for (const value of reports) log(formatStatusLine(value));
    console.log("====================================");
  };
  const localStatus = (key, label, stage) => {
    const file = path.join(
      directory,
      `local-${key.replace(/[^a-zA-Z0-9_.-]+/g, "-")}.json`,
    );
    return {
      update: async (status) => {
        await writeFile(
          `${file}.tmp`,
          `${JSON.stringify(
            createStatusDocument({
              label,
              stage,
              runId,
              updated: new Date().toISOString(),
              status,
            }),
            null,
            2,
          )}\n`,
        );
        await rename(`${file}.tmp`, file);
      },
    };
  };
  return {
    localStatus,
    start() {
      if (process.env.CONDUCTOR_STATUS_REPORTS !== "1") return;
      reporter = setInterval(() => {
        report().catch((error) => log("status report failed", error.message));
      }, 10000);
      reporter.unref();
    },
    stop() {
      if (reporter) clearInterval(reporter);
    },
  };
}
