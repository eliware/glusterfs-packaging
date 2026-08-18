#!/usr/bin/env node
import path from "node:path";
import { readdir, writeFile } from "node:fs/promises";
import { env, repoRoot, run, runInteractive } from "../scripts/lib.mjs";
import { withMetadataVersion } from "../scripts/metadata-version.mjs";

const format = env("PACKAGE_FORMAT");
const packageDir = env("PACKAGE_DIR");
const resultFile = env("SMOKE_RESULT", path.join(repoRoot, "validation.json"));
const smokeBrickRoot = env("SMOKE_BRICK_ROOT", "/var/lib/gluster-smoke/brick");
const distribution = env(
  "SMOKE_DISTRIBUTION",
  format === "rpm" ? "centos-stream-10" : "debian-bookworm",
);
const conductorRunId = env("CONDUCTOR_RUN_ID");
if (!conductorRunId) throw new Error("CONDUCTOR_RUN_ID is required");

if (!format || !["rpm", "deb"].includes(format))
  throw new Error("PACKAGE_FORMAT must be rpm or deb");
if (!packageDir) throw new Error("PACKAGE_DIR is required");

let packages = (await readdir(packageDir))
  .filter((file) => file.endsWith(format === "rpm" ? ".rpm" : ".deb"))
  .map((file) => path.join(packageDir, file));
if (!packages.length)
  throw new Error(`no ${format.toUpperCase()} packages found in ${packageDir}`);

if (format === "rpm") {
  const smokeNames = new Set([
    "glusterfs",
    "glusterfs-cli",
    "glusterfs-client-xlators",
    "glusterfs-fuse",
    "glusterfs-server",
    "glusterfs-selinux",
    "libgfapi0",
    "libgfchangelog0",
    "libgfrpc0",
    "libgfxdr0",
    "libglusterfs0",
  ]);
  packages = [];
  for (const file of (await readdir(packageDir))
    .filter((name) => name.endsWith(".rpm") && !name.endsWith(".src.rpm"))
    .map((name) => path.join(packageDir, name))) {
    const identity = (
      await run("rpm", ["-qp", "--qf", "%{NAME}.%{ARCH}", file], {
        capture: true,
      })
    ).stdout.trim();
    const [name, architecture] = identity.split(".");
    if (architecture !== "src" && smokeNames.has(name)) packages.push(file);
  }
  if (!packages.length)
    throw new Error("no core RPM packages found for the package smoke test");
  await runInteractive("dnf", [
    "-y",
    "install",
    "--setopt=install_weak_deps=False",
    ...packages,
  ]);
  await runInteractive("rpm", [
    "-q",
    "glusterfs",
    "glusterfs-cli",
    "glusterfs-fuse",
    "glusterfs-server",
    "glusterfs-selinux",
  ]);
} else {
  await runInteractive("apt-get", ["update"]);
  await runInteractive("apt-get", [
    "install",
    "--yes",
    "--no-install-recommends",
    ...packages,
  ]);
  await runInteractive("dpkg-query", [
    "-W",
    "glusterfs-server",
    "glusterfs-client",
    "glusterfs-cli",
  ]);
}

const lifecycle = `
set -Eeuo pipefail
export LANG=C
export SMOKE_BRICK_ROOT=${JSON.stringify(smokeBrickRoot)}
mkdir -p /run/gluster /var/log/gluster /var/lib/glusterd "$SMOKE_BRICK_ROOT" /mnt/gluster-smoke
glusterd --no-daemon >/var/log/gluster/glusterd-smoke.log 2>&1 &
glusterd_pid=$!
cleanup() {
  set +e
  umount /mnt/gluster-smoke 2>/dev/null
  gluster --mode=script volume stop smokevol 2>/dev/null
  gluster --mode=script volume delete smokevol 2>/dev/null
  rm -rf -- "$SMOKE_BRICK_ROOT"
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
gluster volume create smokevol "$HOSTNAME:$SMOKE_BRICK_ROOT" force
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
`.trim();

await runInteractive("bash", ["-euc", lifecycle]);

const validation = withMetadataVersion({
  run_id: conductorRunId,
  generated: new Date().toISOString(),
  package_format: format,
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
  distributions: [
    {
      id: distribution,
      label: distribution,
      ...(format === "rpm"
        ? { package_core: { status: "passed" } }
        : { package_core: { status: "passed" } }),
    },
  ],
});
await writeFile(resultFile, JSON.stringify(validation, null, 2) + "\n");
console.log(`${format.toUpperCase()} package lifecycle smoke test passed`);
