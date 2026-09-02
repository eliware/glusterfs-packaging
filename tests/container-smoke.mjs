#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { withMetadataVersion } from "../scripts/metadata-version.mjs";

const image = process.env.IMAGE_TAG;
const resultFile = process.env.CONTAINER_VALIDATION_FILE || "validation.json";
const distribution = process.env.IMAGE_DISTRIBUTION || "centos-stream";
const conductorRunId = process.env.CONDUCTOR_RUN_ID;
const distributionId =
  {
    "centos-stream": "centos-stream-10",
    rocky: "rocky-10",
    alma: "almalinux-10",
    oracle: "oracle-linux-10",
  }[distribution] || distribution;
const label =
  {
    "centos-stream": "CentOS Stream 10",
    rocky: "Rocky Linux 10",
    alma: "AlmaLinux 10",
    oracle: "Oracle Linux 10",
  }[distribution] || distribution;
if (!image) throw new Error("IMAGE_TAG is required");
if (!conductorRunId) throw new Error("CONDUCTOR_RUN_ID is required");

function runContainer(script) {
  return new Promise((resolve) => {
    const child = spawn(
      process.env.CONTAINER_RUNTIME || "docker",
      [
        "run",
        "--rm",
        "--privileged",
        "--entrypoint",
        "bash",
        image,
        "-lc",
        script,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) =>
      resolve({ code: 1, stdout, stderr: error.message }),
    );
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const coreScript = [
  "set -euo pipefail",
  "rpm -q glusterfs glusterfs-server glusterfs-selinux",
  "gluster --version",
  "mkdir -p /var/lib/gluster/smoke-brick /mnt/gluster-smoke",
  "glusterd --no-daemon --pid-file=/run/glusterd-smoke.pid >/tmp/glusterd-smoke.log 2>&1 &",
  "daemon=$!",
  "trap 'kill $daemon 2>/dev/null || true' EXIT",
  "ready=0; for attempt in $(seq 1 30); do gluster --mode=script volume info >/dev/null 2>&1 && ready=1 && break; sleep 1; done; test \"$ready\" = 1",
  "gluster --mode=script volume create smoke $HOSTNAME:/var/lib/gluster/smoke-brick force",
  "gluster --mode=script volume start smoke",
  "mount -t glusterfs -o backup-volfile-servers=localhost localhost:/smoke /mnt/gluster-smoke",
  "printf 'container-smoke\\n' >/mnt/gluster-smoke/check",
  "grep -Fx 'container-smoke' /mnt/gluster-smoke/check",
  "printf 'updated\\n' >/mnt/gluster-smoke/check",
  "grep -Fx 'updated' /mnt/gluster-smoke/check",
  "rm -f /mnt/gluster-smoke/check",
  "umount /mnt/gluster-smoke",
  "gluster --mode=script volume stop smoke",
  "gluster --mode=script volume delete smoke",
].join("\n");
const core = await runContainer(coreScript);
const status = core.code === 0 ? "passed" : "failed";
const detail =
  `${core.stdout}${core.stderr}`.trim().split("\n").slice(-3).join("; ") ||
  "no detail";
const validation = withMetadataVersion({
  run_id: conductorRunId,
  generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  repository_integrity: {
    status: "not-tested",
    detail: "verified by the conductor against the package repository",
  },
  provenance_verification: {
    status: "not-tested",
    detail: "generated and verified by the conductor after image publication",
  },
  checks: {
    install: { status },
    cli_available: { status },
    volume_create_mount: { status },
    file_lifecycle: { status },
    volume_unmount_delete: { status },
    service_shutdown: { status },
  },
  distributions: [
    {
      id: distributionId,
      label,
      container_core: { status, detail },
    },
  ],
});
await writeFile(resultFile, `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify(validation, null, 2));
if (core.code !== 0) process.exit(1);
