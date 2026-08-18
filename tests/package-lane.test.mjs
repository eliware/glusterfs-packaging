import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPackageSmoke2 } from "../scripts/package-lane.mjs";

const lane = {
  id: "epel10-stable",
  format: "rpm",
  distribution: "epel10",
};

test("package-lane smoke-2 dry run reports every target without side effects", async () => {
  const result = await runPackageSmoke2({
    lane,
    packageRoot: "/unused",
    smokeWorkspace: "/unused",
    dryRun: true,
  });

  expect(result).toEqual([
    {
      target_os: "centos-stream-10",
      validation: {
        dry_run: true,
        distributions: [
          { id: "centos-stream-10", package_core: { status: "passed" } },
        ],
      },
    },
    {
      target_os: "rocky-10",
      validation: {
        dry_run: true,
        distributions: [{ id: "rocky-10", package_core: { status: "passed" } }],
      },
    },
    {
      target_os: "almalinux-10",
      validation: {
        dry_run: true,
        distributions: [
          { id: "almalinux-10", package_core: { status: "passed" } },
        ],
      },
    },
    {
      target_os: "oracle-linux-10",
      validation: {
        dry_run: true,
        distributions: [
          { id: "oracle-linux-10", package_core: { status: "passed" } },
        ],
      },
    },
  ]);
});

test("package-lane rejects a missing candidate package directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "package-lane-"));
  try {
    await expect(
      runPackageSmoke2({
        lane,
        packageRoot: path.join(directory, "missing"),
        smokeWorkspace: directory,
        dryRun: false,
      }),
    ).rejects.toThrow("package directory for smoke-2 is missing");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
