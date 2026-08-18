#!/usr/bin/env node
import path from "node:path";
import { notifyConductor } from "./discord-notifier.mjs";
import { run, repoRoot } from "./lib.mjs";

const conductor =
  process.env.CONDUCTOR_SERVICE_CONDUCTOR ||
  path.join(repoRoot, "scripts/conductor.mjs");
let phase = "dry-run";

try {
  console.log("[conductor-service] starting dry-run preflight");
  await run(process.execPath, [conductor, "--dry-run"], { stream: true });
  phase = "wet-run";
  console.log("[conductor-service] dry-run passed; starting wet-run");
  await run(process.execPath, [conductor, "--wet-run"], { stream: true });
  console.log("[conductor-service] wet-run completed");
} catch (error) {
  console.error(`[conductor-service] ${phase} failed: ${error.message}`);
  await notifyConductor({
    title: `Conductor ${phase} failed`,
    description:
      phase === "dry-run"
        ? "The safety preflight failed; the wet-run was not started."
        : "The wet-run process failed after passing the safety preflight.",
    status: "failure",
    fields: [
      { name: "Phase", value: phase },
      { name: "Error", value: error.message },
    ],
  });
  process.exitCode = 1;
}
