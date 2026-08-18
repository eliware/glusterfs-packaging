import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  waitForCandidate,
  writeCandidateManifest,
} from "../scripts/candidate-readiness.mjs";

test("candidate readiness records and verifies package files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "candidate-ready-"));
  try {
    const candidate = path.join(root, "candidate");
    const packages = path.join(candidate, "rpm");
    await mkdir(path.join(packages, "repodata"), { recursive: true });
    await writeFile(path.join(packages, "glusterfs-11.2.rpm"), "rpm\n");
    await writeFile(
      path.join(packages, "repodata", "repomd.xml"),
      "metadata\n",
    );

    const result = await writeCandidateManifest({
      candidateDir: candidate,
      packageDir: packages,
    });
    expect(result.manifest.files).toHaveLength(2);
    expect(
      JSON.parse(await readFile(result.readyPath, "utf8")).file_count,
    ).toBe(2);

    const verified = await waitForCandidate({
      candidateDir: candidate,
      packageDir: packages,
      timeoutMs: 100,
      intervalMs: 10,
    });
    expect(verified.files.map(({ path: file }) => file)).toEqual([
      "glusterfs-11.2.rpm",
      "repodata/repomd.xml",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate readiness rejects changed package content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "candidate-ready-"));
  try {
    const candidate = path.join(root, "candidate");
    const packages = path.join(candidate, "deb");
    await mkdir(packages, { recursive: true });
    const packageFile = path.join(packages, "glusterfs.deb");
    await writeFile(packageFile, "original\n");
    await writeCandidateManifest({
      candidateDir: candidate,
      packageDir: packages,
    });
    await writeFile(packageFile, "changed content\n");

    await expect(
      waitForCandidate({
        candidateDir: candidate,
        packageDir: packages,
        timeoutMs: 100,
        intervalMs: 10,
      }),
    ).rejects.toThrow("candidate file size changed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
