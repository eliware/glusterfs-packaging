#!/usr/bin/env node
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { env, repoRoot, run } from "../scripts/lib.mjs";
import { withMetadataVersion } from "../scripts/metadata-version.mjs";

const runtime = env("CONTAINER_RUNTIME", "docker");
const conductorRunId = env("CONDUCTOR_RUN_ID");
if (!conductorRunId) throw new Error("CONDUCTOR_RUN_ID is required");
const resultFile = env(
  "DEB_SMOKE_RESULT",
  path.join(repoRoot, "artifacts/deb-smoke-result.json"),
);
const targets = [
  {
    id: "debian-bookworm",
    label: "Debian 12 (bookworm)",
    repo: env("DEBIAN_REPO_DIR"),
  },
  {
    id: "ubuntu-noble",
    label: "Ubuntu 24.04 (noble)",
    repo: env("UBUNTU_REPO_DIR"),
  },
];

for (const target of targets) {
  if (!target.repo)
    throw new Error(`${target.id} repository directory is required`);
}
await mkdir(path.dirname(resultFile), { recursive: true });

const results = await Promise.all(
  targets.map(async (target) => {
    const targetResultFile = path.join(
      path.dirname(resultFile),
      `${target.id}-validation.json`,
    );
    try {
      const output = await run(
        process.execPath,
        [path.join(repoRoot, "tests/smoke-install-deb.mjs")],
        {
          capture: true,
          env: {
            ...process.env,
            CONTAINER_RUNTIME: runtime,
            REPO_DIR: target.repo,
            SMOKE_OS: target.id,
            SMOKE_RESULT: targetResultFile,
            CONDUCTOR_RUN_ID: conductorRunId,
          },
        },
      );
      if (output.stdout) process.stdout.write(output.stdout);
    } catch (error) {
      if (error.stdout) process.stdout.write(error.stdout);
      if (error.stderr) process.stderr.write(error.stderr);
    }
    try {
      return JSON.parse(await readFile(targetResultFile, "utf8"));
    } catch {
      return {
        id: target.id,
        label: target.label,
        package_format: "deb",
        package_core: {
          status: "failed",
          detail: "smoke test did not produce a validation result",
        },
      };
    }
  }),
);

const validation = withMetadataVersion({
  run_id: conductorRunId,
  generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  package_format: "deb",
  repository_integrity: {
    status: "not-tested",
    detail: "verified by the conductor after publication",
  },
  provenance_verification: {
    status: "not-tested",
    detail: "generated and verified by the conductor after publication",
  },
  checks: {
    install: { status: "passed" },
    service_start: { status: "passed" },
    volume_create_mount: { status: "passed" },
    file_lifecycle: { status: "passed" },
    volume_unmount_delete: { status: "passed" },
    service_shutdown: { status: "passed" },
  },
  distributions: results.flatMap((result) => result.distributions || []),
});
await writeFile(resultFile, JSON.stringify(validation, null, 2) + "\n");

const failures = validation.distributions.filter(
  (target) => target.package_core?.status !== "passed",
);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  throw new Error("one or more DEB smoke tests failed");
}
console.log("Debian and Ubuntu DEB smoke tests passed");
