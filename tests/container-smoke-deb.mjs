#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { withMetadataVersion } from "../scripts/metadata-version.mjs";

const image = process.env.IMAGE || process.env.IMAGE_TAG;
const distribution = process.env.DISTRIBUTION || "debian";
const resultFile = process.env.CONTAINER_VALIDATION_FILE || "validation.json";
const conductorRunId = process.env.CONDUCTOR_RUN_ID;
if (!image) throw new Error("IMAGE is required");
if (!conductorRunId) throw new Error("CONDUCTOR_RUN_ID is required");
const target =
  distribution === "ubuntu"
    ? { id: "ubuntu-noble", label: "Ubuntu 24.04 (noble)" }
    : { id: "debian-bookworm", label: "Debian 12 (bookworm)" };
const script = `
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends procps
dpkg-query --show glusterfs-client glusterfs-server
gluster --version
mkdir -p /run/gluster /var/log/gluster /var/lib/gluster/smoke-brick /mnt/gluster-smoke
glusterd --no-daemon >/var/log/gluster/glusterd-smoke.log 2>&1 &
daemon=$!
cleanup() { set +e; umount /mnt/gluster-smoke 2>/dev/null; gluster --mode=script volume stop smoke 2>/dev/null; gluster --mode=script volume delete smoke 2>/dev/null; kill $daemon 2>/dev/null; wait $daemon 2>/dev/null; }
trap cleanup EXIT
ready=0; for attempt in $(seq 1 60); do gluster volume info >/dev/null 2>&1 && ready=1 && break; kill -0 $daemon 2>/dev/null || { cat /var/log/gluster/glusterd-smoke.log; exit 1; }; sleep 1; done; test "$ready" = 1
gluster volume create smoke "$HOSTNAME:/var/lib/gluster/smoke-brick" force
gluster volume start smoke
mount -t glusterfs -o backup-volfile-servers=localhost localhost:/smoke /mnt/gluster-smoke
printf 'first value\n' >/mnt/gluster-smoke/check
test "$(cat /mnt/gluster-smoke/check)" = 'first value'
printf 'updated value\n' >/mnt/gluster-smoke/check
test "$(cat /mnt/gluster-smoke/check)" = 'updated value'
rm /mnt/gluster-smoke/check
umount /mnt/gluster-smoke
gluster --mode=script volume stop smoke
gluster --mode=script volume delete smoke
`;
const child = spawn(
  process.env.CONTAINER_RUNTIME || "docker",
  [
    "run",
    "--rm",
    "--privileged",
    "--entrypoint",
    "bash",
    image,
    "-ceu",
    script,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});
const code = await new Promise((resolve) =>
  child.once("exit", (value) => resolve(value ?? 1)),
);
const status = code === 0 ? "passed" : "failed";
const detail =
  `${stdout}${stderr}`.trim().split(/\r?\n/).slice(-3).join("; ") ||
  "no detail";
const validation = withMetadataVersion({
  run_id: conductorRunId,
  generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  repository_integrity: {
    status: "not-tested",
    detail: "verified by the conductor",
  },
  provenance_verification: {
    status: "not-tested",
    detail: "verified by the conductor",
  },
  checks: Object.fromEntries(
    [
      "install",
      "cli_available",
      "volume_create_mount",
      "file_lifecycle",
      "volume_unmount_delete",
      "service_shutdown",
    ].map((name) => [name, { status }]),
  ),
  distributions: [
    { id: target.id, label: target.label, container_core: { status, detail } },
  ],
});
await writeFile(resultFile, `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify(validation, null, 2));
if (code !== 0) process.exit(code);
