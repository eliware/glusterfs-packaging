#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { env, run } from "../scripts/lib.mjs";
import { withMetadataVersion } from "../scripts/metadata-version.mjs";

const runtime = env("CONTAINER_RUNTIME", "docker");
const repoDir = env("REPO_DIR");
const target = env("SMOKE_OS", "debian-bookworm");
const resultFile = env("SMOKE_RESULT", "");
const conductorRunId = env("CONDUCTOR_RUN_ID");
if (!conductorRunId) throw new Error("CONDUCTOR_RUN_ID is required");
const targets = {
  "debian-bookworm": {
    label: "Debian 12 (bookworm)",
    image: "debian:12-slim",
  },
  "ubuntu-noble": {
    label: "Ubuntu 24.04 (noble)",
    image: "ubuntu:24.04",
  },
};
const selected = targets[target];
if (!repoDir) throw new Error("REPO_DIR is required");
if (!selected) throw new Error("unknown DEB smoke target: " + target);

const lifecycle = [
  "set -Eeuo pipefail",
  "export DEBIAN_FRONTEND=noninteractive",
  "apt-get update",
  "apt-get install -y --no-install-recommends ca-certificates procps",
  "if [ -f /repo/dists/stable/main/binary-amd64/Packages ]; then",
  "  printf 'deb [trusted=yes] file:/repo stable main\\n' > /etc/apt/sources.list.d/eliware-gluster.list",
  "  apt-get update",
  "  apt-get install -y glusterfs-server glusterfs-client glusterfs-cli",
  "else",
  "  mapfile -t packages < <(find /repo -type f -name '*.deb' -print)",
  "  ((${#packages[@]} > 0))",
  '  apt-get install -y "${packages[@]}"',
  "fi",
  "dpkg-query -W glusterfs-server glusterfs-client glusterfs-cli",
  "glusterd --version",
  "mkdir -p /run/gluster /var/log/gluster /var/lib/glusterd /var/lib/gluster-smoke/brick /mnt/gluster-smoke",
  "glusterd --no-daemon >/var/log/gluster/glusterd-smoke.log 2>&1 &",
  "pid=$!",
  "cleanup() { set +e; gluster --mode=script volume stop smokevol; gluster --mode=script volume delete smokevol; kill $pid; wait $pid; }",
  "trap cleanup EXIT",
  "for attempt in $(seq 1 60); do gluster volume info >/dev/null 2>&1 && break; kill -0 $pid 2>/dev/null || { cat /var/log/gluster/glusterd-smoke.log; exit 1; }; sleep 1; done",
  'gluster volume create smokevol "$HOSTNAME:/var/lib/gluster-smoke/brick" force',
  "gluster volume start smokevol",
  "gluster volume info smokevol",
  "mount -t glusterfs -o backup-volfile-servers=localhost localhost:/smokevol /mnt/gluster-smoke",
  "test ! -e /mnt/gluster-smoke/smoke.txt",
  "printf 'first value\\n' >/mnt/gluster-smoke/smoke.txt",
  'test "$(cat /mnt/gluster-smoke/smoke.txt)" = "first value"',
  "printf 'updated value\\n' >/mnt/gluster-smoke/smoke.txt",
  'test "$(cat /mnt/gluster-smoke/smoke.txt)" = "updated value"',
  "rm /mnt/gluster-smoke/smoke.txt",
  "test ! -e /mnt/gluster-smoke/smoke.txt",
  "umount /mnt/gluster-smoke",
  "gluster volume stop smokevol",
  "gluster volume delete smokevol",
].join("\n");

const result = {
  id: target,
  label: selected.label,
  image: selected.image,
  package_format: "deb",
  package_core: { status: "not-tested" },
};
try {
  await run(runtime, [
    "run",
    "--rm",
    "--privileged",
    "--volume",
    repoDir + ":/repo:ro",
    selected.image,
    "bash",
    "-euc",
    lifecycle,
  ]);
  result.package_core = { status: "passed" };
} catch (error) {
  result.package_core = { status: "failed", detail: error.message };
  if (resultFile)
    await writeFile(
      resultFile,
      JSON.stringify(
        withMetadataVersion({
          run_id: conductorRunId,
          generated: new Date().toISOString(),
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
            install: { status: "failed" },
            service_start: { status: "failed" },
            volume_create_mount: { status: "failed" },
            file_lifecycle: { status: "failed" },
            volume_unmount_delete: { status: "failed" },
            service_shutdown: { status: "failed" },
          },
          distributions: [result],
        }),
        null,
        2,
      ) + "\n",
    );
  throw error;
}
if (resultFile)
  await writeFile(
    resultFile,
    JSON.stringify(
      withMetadataVersion({
        run_id: conductorRunId,
        generated: new Date().toISOString(),
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
        distributions: [result],
      }),
      null,
      2,
    ) + "\n",
  );
console.log("DEB smoke test passed for " + target);
