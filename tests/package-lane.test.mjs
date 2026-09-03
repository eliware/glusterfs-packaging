import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPackageSmoke2 } from "../scripts/package-lane.mjs";

const lane = { id: "epel10-stable", format: "rpm", distribution: "epel10" };

test("package-lane smoke-2 dry run reports every target without side effects", async () => {
  const result = await runPackageSmoke2({ lane, packageRoot: "/unused", smokeWorkspace: "/unused", dryRun: true });
  expect(result).toHaveLength(4);
  expect(result.map(({ target_os }) => target_os)).toEqual([
    "centos-stream-10", "rocky-10", "almalinux-10", "oracle-linux-10",
  ]);
});

test("package-lane rejects a missing candidate package directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "package-lane-"));
  try {
    await expect(runPackageSmoke2({ lane, packageRoot: path.join(directory, "missing"), smokeWorkspace: directory, dryRun: false })).rejects.toThrow("package directory for smoke-2 is missing");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("passes candidateRoot into smoke-2 target execution", async () => {
  const source = await readFile("scripts/package-lane.mjs", "utf8");
  expect(source).toContain("candidateRoot,");
  expect(source).toContain('UNSIGNED_CANDIDATE: candidateRoot ? "1" : "0"');
});
