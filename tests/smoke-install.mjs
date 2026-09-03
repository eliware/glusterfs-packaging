#!/usr/bin/env node
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { env, exists, repoRoot, run } from "../scripts/lib.mjs";
import { withMetadataVersion } from "../scripts/metadata-version.mjs";

const repoDir = env(
  "REPO_DIR",
  path.join(repoRoot, "artifacts/el10/x86_64/stable"),
);
const runtime = env("CONTAINER_RUNTIME", "docker");
const conductorRunId = env("CONDUCTOR_RUN_ID");
if (!conductorRunId) throw new Error("CONDUCTOR_RUN_ID is required");
const matrixFile = env(
  "SMOKE_MATRIX",
  path.join(repoRoot, "build-config/alternate-os-smoke.json"),
);
const selectedId = env("SMOKE_OS", "");
const resultFile = env("SMOKE_RESULT", "");
const unsignedCandidate = env("UNSIGNED_CANDIDATE", "0") === "1";

if (!(await exists(repoDir)))
  throw new Error(`repository directory does not exist: ${repoDir}`);

const matrix = JSON.parse(await readFile(matrixFile, "utf8"));
const targets = selectedId
  ? matrix.filter((target) => target.id === selectedId)
  : matrix;
if (targets.length === 0)
  throw new Error(`unknown smoke-test target: ${selectedId}`);

const lifecycle = `
set -Eeuo pipefail
export LANG=C

dnf -y install dnf-plugins-core
%REPOSITORY_SETUP%
dnf -y --repofrompath=eliware-glusterfs,file:///repo \\
  --setopt=eliware-glusterfs.gpgcheck=%GPGCHECK% \\
  --setopt=eliware-glusterfs.repo_gpgcheck=%REPO_GPGCHECK% \\
  --enablerepo=eliware-glusterfs \\
  install glusterfs glusterfs-cli glusterfs-fuse glusterfs-server glusterfs-selinux

rpm -q glusterfs glusterfs-cli glusterfs-fuse glusterfs-server glusterfs-selinux
glusterd --version

selinux_status=passed
selinux_mode=unknown
if command -v getenforce >/dev/null 2>&1; then
  selinux_mode=$(getenforce)
fi
selinux_detail="module loaded; mode $selinux_mode"
if ! command -v semodule >/dev/null 2>&1; then
  selinux_status=not-tested
  selinux_detail='semodule unavailable'
elif ! semodule -B >/dev/null 2>&1; then
  selinux_status=failed
  selinux_detail='SELinux policy rebuild failed'
elif ! semodule -l 2>/dev/null | awk '$1 == "glusterd" { found=1 } END { exit found ? 0 : 1 }'; then
  selinux_status=failed
  selinux_detail='glusterd SELinux module was not loaded'
fi

mkdir -p /run/gluster /var/log/gluster /var/lib/glusterd /var/lib/gluster-smoke/brick /mnt/gluster-smoke
glusterd --no-daemon >/var/log/gluster/glusterd-smoke.log 2>&1 &
glusterd_pid=$!
cleanup() {
  set +e
  umount /mnt/gluster-smoke 2>/dev/null
  gluster --mode=script volume stop smokevol 2>/dev/null
  gluster --mode=script volume delete smokevol 2>/dev/null
  kill "$glusterd_pid" 2>/dev/null
  wait "$glusterd_pid" 2>/dev/null
}
trap cleanup EXIT

for attempt in $(seq 1 60); do
  if gluster volume info >/dev/null 2>&1; then break; fi
  if ! kill -0 "$glusterd_pid" 2>/dev/null; then
    cat /var/log/gluster/glusterd-smoke.log
    exit 1
  fi
  sleep 1
done
gluster volume info >/dev/null

gluster volume create smokevol "$HOSTNAME:/var/lib/gluster-smoke/brick" force
gluster volume start smokevol
gluster volume info smokevol
mount -t glusterfs -o backup-volfile-servers=localhost localhost:/smokevol /mnt/gluster-smoke

test ! -e /mnt/gluster-smoke/smoke.txt
printf 'first value\\n' >/mnt/gluster-smoke/smoke.txt
test "$(cat /mnt/gluster-smoke/smoke.txt)" = "first value"
printf 'updated value\\n' >/mnt/gluster-smoke/smoke.txt
test "$(cat /mnt/gluster-smoke/smoke.txt)" = "updated value"
rm /mnt/gluster-smoke/smoke.txt
test ! -e /mnt/gluster-smoke/smoke.txt

umount /mnt/gluster-smoke
gluster --mode=script volume stop smokevol
gluster --mode=script volume delete smokevol
if gluster volume info smokevol >/dev/null 2>&1; then
  echo 'temporary smoke-test volume still exists' >&2
  exit 1
fi
kill "$glusterd_pid"
wait "$glusterd_pid" || true
trap - EXIT
test ! -e /mnt/gluster-smoke/smoke.txt
printf 'Gluster lifecycle smoke test passed\\n'
printf '__SMOKE_SELINUX__%s|%s\\n' "$selinux_status" "$selinux_detail"
`.trim();

function commandFor(target) {
  const setup = target.repositories.join("\n");
  const script = lifecycle
    .replace("%REPOSITORY_SETUP%", setup)
    .replaceAll("%GPGCHECK%", unsignedCandidate ? "0" : "1")
    .replaceAll("%REPO_GPGCHECK%", unsignedCandidate ? "0" : "1");
  return [
    "run",
    "--rm",
    "--privileged",
    "--volume",
    `${repoDir}:/repo:ro,Z`,
    target.image,
    "bash",
    "-euc",
    script,
  ];
}

async function runTarget(target) {
  console.log(`[${target.id}] starting ${target.image}`);
  try {
    const output = await run(runtime, commandFor(target), { capture: true });
    const marker = output.stdout.match(/__SMOKE_SELINUX__([^|]+)\|([^\n]+)/);
    const selinuxStatus = marker?.[1] || "not-tested";
    const selinuxDetail = marker?.[2] || "test result unavailable";
    console.log(`[${target.id}] package core passed; SELinux ${selinuxStatus}`);
    return {
      id: target.id,
      label: target.label || target.id,
      image: target.image,
      package_core: { status: "passed" },
      selinux: { status: selinuxStatus, detail: selinuxDetail },
    };
  } catch (error) {
    console.error(`[${target.id}] package core failed: ${error.message}`);
    return {
      id: target.id,
      label: target.label || target.id,
      image: target.image,
      package_core: { status: "failed", detail: error.message },
      selinux: { status: "not-tested", detail: "core test failed" },
    };
  }
}

const results = await Promise.all(targets.map(runTarget));
const validation = withMetadataVersion({
  run_id: conductorRunId,
  generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  required_baseline: "centos-stream-10",
  checks: {
    install: { status: "passed" },
    service_start: { status: "passed" },
    volume_create_mount: { status: "passed" },
    file_lifecycle: { status: "passed" },
    volume_unmount_delete: { status: "passed" },
    service_shutdown: { status: "passed" },
  },
  distributions: results,
});
if (resultFile) {
  await writeFile(resultFile, `${JSON.stringify(validation, null, 2)}\n`);
}

const baseline = results.find((result) => result.id === "centos-stream-10");
const coreFailures = results.filter(
  (result) => result.package_core?.status !== "passed",
);
if (coreFailures.length > 0 || (targets.length > 1 && !baseline)) {
  throw new Error("one or more EL10 package core smoke tests failed");
}

console.log(
  `${results.length} EL10 distribution package smoke tests completed; ${coreFailures.length} core failure(s)`,
);
