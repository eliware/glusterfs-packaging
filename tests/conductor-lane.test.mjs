import { createLaneImageRecorder } from "../scripts/conductor-lane.mjs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const createRecorder = (overrides = {}) =>
  createLaneImageRecorder({
    baseImages: { centos: "quay.io/example/centos@sha256:base" },
    enqueuePublication: async (_label, operation) => operation(),
    lane: {
      id: "epel10-stable",
      channel: "stable",
      version: "11.2",
      sourceRef: "v11.2",
      sourceCommit: "source-commit",
    },
    pathRoot: "/tmp/repository",
    repoRoot: "/tmp/packaging",
    runId: "run-1",
    runInteractive: async () => {},
    tempDir: async () => "/tmp/container-validation",
    validationFile: "/tmp/validation.json",
    ...overrides,
  });

test("lane image recorder rejects results without an immutable image digest", async () => {
  const recordImage = createRecorder();

  await expect(
    recordImage(
      { image: "ghcr.io/eliware/example:11.2" },
      "centos",
      "",
      "centos",
      "",
    ),
  ).rejects.toThrow("no immutable digest for centos");
});

test("lane image recorder publishes through the serialized callback", async () => {
  const pathRoot = await mkdtemp(path.join(os.tmpdir(), "conductor-lane-"));
  await mkdir(path.join(pathRoot, "metadata"), { recursive: true });
  await writeFile(
    path.join(pathRoot, "metadata/active-generation.json"),
    JSON.stringify({ generation: "generation-1" }),
  );
  const calls = [];
  const recordImage = createRecorder({
    pathRoot,
    repoRoot: pathRoot,
    enqueuePublication: async (label, operation) => {
      calls.push(label);
      await operation();
    },
    runInteractive: async (...args) => {
      calls.push(args[1]);
      if (args[1][0].endsWith("scripts/write-catalog.mjs"))
        await writeFile(args[1][2], "{}");
    },
    tempDir: async () => {
      const directory = path.join(pathRoot, "container-validation");
      await mkdir(directory, { recursive: true });
      return directory;
    },
  });

  await recordImage(
    {
      image: "ghcr.io/eliware/example:11.2",
      digest: "sha256:image",
      container_validation: { status: "passed" },
    },
    "centos",
    "/metadata/image/provenance.json",
    "centos",
    "/metadata/package/provenance.json",
  );

  expect(calls[0]).toBe("epel10-stable/centos");
  expect(calls.filter(Array.isArray)).toHaveLength(3);
  expect(
    JSON.parse(
      await readFile(path.join(pathRoot, "metadata/catalog.json"), "utf8"),
    ),
  ).toEqual({});
  await rm(pathRoot, { recursive: true, force: true });
});
