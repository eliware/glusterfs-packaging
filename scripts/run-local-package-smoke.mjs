#!/usr/bin/env node
import path from "node:path";
import { exists, env, repoRoot, run } from "./lib.mjs";

const format = env("PACKAGE_FORMAT");
const repoDir = env("REPO_DIR");
const target = env("SMOKE_OS");
const resultFile = env("SMOKE_RESULT");
if (!repoDir || !target || !resultFile)
  throw new Error(
    "PACKAGE_FORMAT, REPO_DIR, SMOKE_OS, and SMOKE_RESULT are required",
  );
if (!(await exists(repoDir)))
  throw new Error(`package directory does not exist: ${repoDir}`);

const script =
  format === "rpm"
    ? path.join(repoRoot, "tests/smoke-install.mjs")
    : format === "deb"
      ? path.join(repoRoot, "tests/smoke-install-deb.mjs")
      : null;
if (!script) throw new Error(`unsupported package format: ${format}`);

console.log(`[local-smoke-2] ${format} ${target} starting`);
await run("node", [script], {
  stream: true,
  env: {
    ...process.env,
    PACKAGE_FORMAT: format,
    REPO_DIR: repoDir,
    SMOKE_OS: target,
    SMOKE_RESULT: resultFile,
    CONTAINER_RUNTIME: env("CONTAINER_RUNTIME", "docker"),
    CONDUCTOR_RUN_ID: env("CONDUCTOR_RUN_ID"),
  },
});
console.log(`[local-smoke-2] ${format} ${target} passed`);
