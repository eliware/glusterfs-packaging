import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildLocalImage } from "../scripts/local-image-build.mjs";
import { smokeTestLocalImage } from "../scripts/local-image-smoke.mjs";
import { publishLocalImage } from "../scripts/local-image-publish.mjs";
import {
  reconcilePendingImagePublication,
  writeLocalImageResult,
  writePendingImagePublication,
} from "../scripts/local-image-result.mjs";

const logicalPath = (value) => String(value).replaceAll("\\", "/");

test("refactored local image stages preserve the previous RPM order", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "gluster-image-behavior-"),
  );
  const calls = [];
  const config = {
    image: "ghcr.io/eliware/centos10-gluster:11.2",
    packageFormat: "rpm",
    distribution: "centos-stream",
    dockerfile: "containers/centos10-gluster.Dockerfile",
    baseImage: "quay.io/centos/centos:stream10",
    baseImageDigest: "sha256:base",
    version: "11.2",
    packagingCommit: "packaging",
    sourceRef: "v11.2",
    sourceCommit: "source",
    packageCandidate: "candidate",
    packageProvenance: "provenance",
    rpmRepoUrl: "https://example.test/el10",
    rpmMetadataSha256: "metadata",
    buildLog: path.join(directory, "image-build.log"),
    validationFile: path.join(directory, "container-validation.json"),
    outputFile: path.join(directory, "image-result.json"),
    runtime: "docker",
    repoRoot: "/repo",
    conductorRunId: "run-1",
    publishScript: "/repo/scripts/publish-image.mjs",
    aliases: ["latest"],
    publishImage: true,
    log: () => {},
    loggedRun: async (command, args) => calls.push(["run", command, args]),
    loggedInteractive: async (command, args) =>
      calls.push(["interactive", command, args]),
    run: async () => ({
      stdout: "ghcr.io/eliware/centos10-gluster@sha256:digest\n",
    }),
  };
  await writeFile(config.validationFile, '{"passed":true}\n');

  try {
    await buildLocalImage(config);
    await smokeTestLocalImage(config);
    await writePendingImagePublication(config);
    await publishLocalImage(config);
    await writeLocalImageResult(config);

    expect(
      calls.map(([kind, command, args]) => [kind, command, logicalPath(args[0])]),
    ).toEqual([
      ["run", "docker", "build"],
      ["run", "node", "/repo/tests/container-smoke.mjs"],
      ["interactive", "node", "/repo/scripts/image-labels.mjs"],
      ["run", "docker", "tag"],
      ["interactive", "node", "/repo/scripts/publish-image.mjs"],
      ["interactive", "node", "/repo/scripts/publish-image.mjs"],
    ]);
    expect(calls[0][2]).toEqual([
      "build",
      "--file",
      config.dockerfile,
      "--tag",
      config.image,
      "--build-arg",
      "BASE_IMAGE=quay.io/centos/centos:stream10",
      "--build-arg",
      "BASE_IMAGE_DIGEST=sha256:base",
      "--build-arg",
      "DISTRIBUTION=centos-stream",
      "--build-arg",
      "PACKAGING_COMMIT=packaging",
      "--build-arg",
      "SOURCE_REF=v11.2",
      "--build-arg",
      "SOURCE_COMMIT=source",
      "--build-arg",
      "PACKAGE_CANDIDATE=candidate",
      "--build-arg",
      "PACKAGE_PROVENANCE=provenance",
      "--build-arg",
      "RELEASE_VERSION=11.2",
      "--build-arg",
      "RPM_REPO_URL=https://example.test/el10",
      "--build-arg",
      "RPM_METADATA_SHA256=metadata",
      "/repo",
    ]);
    expect(JSON.parse(await readFile(config.outputFile, "utf8"))).toMatchObject(
      {
        image: config.image,
        digest: "sha256:digest",
        container_validation: { passed: true },
      },
    );
    await expect(
      readFile(`${config.outputFile}.pending`, "utf8"),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refactored local image stages preserve the previous DEB order", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "gluster-image-deb-behavior-"),
  );
  const calls = [];
  const config = {
    image: "ghcr.io/eliware/debian12-gluster:11.2",
    packageFormat: "deb",
    distribution: "debian",
    dockerfile: "containers/debian12-gluster.Dockerfile",
    baseImage: "debian:12",
    baseImageDigest: "sha256:base-deb",
    version: "11.2",
    packagingCommit: "packaging",
    sourceRef: "v11.2",
    sourceCommit: "source",
    packageCandidate: "candidate-deb",
    packageProvenance: "provenance-deb",
    debRepoUrl: "https://example.test/debian",
    buildLog: path.join(directory, "image-build.log"),
    validationFile: path.join(directory, "container-validation.json"),
    outputFile: path.join(directory, "image-result.json"),
    runtime: "docker",
    repoRoot: "/repo",
    conductorRunId: "run-deb-1",
    publishScript: "/repo/scripts/publish-image.mjs",
    aliases: ["latest"],
    publishImage: true,
    log: () => {},
    loggedRun: async (command, args) => calls.push(["run", command, args]),
    loggedInteractive: async (command, args) =>
      calls.push(["interactive", command, args]),
    run: async () => ({
      stdout: "ghcr.io/eliware/debian12-gluster@sha256:deb-digest\n",
    }),
  };
  await writeFile(config.validationFile, '{"passed":true}\n');

  try {
    await buildLocalImage(config);
    await smokeTestLocalImage(config);
    await publishLocalImage(config);
    await writeLocalImageResult(config);

    expect(
      calls.map(([kind, command, args]) => [kind, command, logicalPath(args[0])]),
    ).toEqual([
      ["run", "docker", "build"],
      ["run", "node", "/repo/tests/container-smoke-deb.mjs"],
      ["interactive", "node", "/repo/scripts/image-labels.mjs"],
      ["run", "docker", "tag"],
      ["interactive", "node", "/repo/scripts/publish-image.mjs"],
      ["interactive", "node", "/repo/scripts/publish-image.mjs"],
    ]);
    expect(calls[0][2].slice(-5)).toEqual([
      "--build-arg",
      "GLUSTER_VERSION=11.2",
      "--build-arg",
      "DEB_REPO_URL=https://example.test/debian",
      "/repo",
    ]);
    expect(JSON.parse(await readFile(config.outputFile, "utf8"))).toMatchObject(
      {
        image: config.image,
        digest: "sha256:deb-digest",
        package_format: "deb",
        container_validation: { passed: true },
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a smoke-test failure stops before label verification or publication", async () => {
  const calls = [];
  const config = {
    packageFormat: "deb",
    repoRoot: "/repo",
    image: "ghcr.io/eliware/ubuntu24-gluster:11.2",
    distribution: "ubuntu",
    runtime: "docker",
    validationFile: "/tmp/validation.json",
    conductorRunId: "run-failure-1",
    loggedRun: async (command, args) => {
      calls.push(["run", command, args]);
      throw new Error("simulated smoke failure");
    },
    loggedInteractive: async (command, args) =>
      calls.push(["interactive", command, args]),
  };

  await expect(smokeTestLocalImage(config)).rejects.toThrow(
    "simulated smoke failure",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toBe("node");
  expect(logicalPath(calls[0][2][0])).toBe("/repo/tests/container-smoke-deb.mjs");
});

test.each([
  ["epel10-stable", "rpm", "centos-stream", "container-smoke.mjs"],
  ["epel10-rolling", "rpm", "centos-stream", "container-smoke.mjs"],
  ["debian-stable", "deb", "debian", "container-smoke-deb.mjs"],
  ["debian-rolling", "deb", "debian", "container-smoke-deb.mjs"],
  ["ubuntu-stable", "deb", "ubuntu", "container-smoke-deb.mjs"],
  ["ubuntu-rolling", "deb", "ubuntu", "container-smoke-deb.mjs"],
])(
  "uses the host Node smoke runner for the %s image lane",
  async (lane, packageFormat, distribution, smokeFile) => {
    const calls = [];
    const config = {
      packageFormat,
      distribution,
      image: `example/${lane}:test`,
      repoRoot: "/repo",
      runtime: "docker",
      validationFile: "/tmp/validation.json",
      conductorRunId: `run-${lane}`,
      loggedRun: async (command, args) => calls.push([command, args]),
      loggedInteractive: async (command, args) => calls.push([command, args]),
    };

    await smokeTestLocalImage(config);

    expect([calls[0][0], calls[0][1].map(logicalPath)]).toEqual([
      "node",
      [`/repo/tests/${smokeFile}`],
    ]);
  },
);

test("reconciles a pending publication when the pushed digest is available", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "gluster-image-reconcile-"),
  );
  const outputFile = path.join(directory, "image-result.json");
  const pendingFile = `${outputFile}.pending`;
  const validationFile = path.join(directory, "container-validation.json");
  await writeFile(validationFile, '{"passed":true}\n');
  await writeFile(
    pendingFile,
    JSON.stringify({
      status: "pending",
      image: "ghcr.io/eliware/ubuntu24-gluster:11.2",
      aliases: [],
      version: "11.2",
      distribution: "ubuntu",
      package_format: "deb",
      package_candidate: "ubuntu-stable-11.2",
      package_provenance: "/ubuntu/noble/stable/provenance.json",
      base_image: "ubuntu:24.04",
      base_image_digest: "sha256:base",
      source_ref: "v11.2",
      source_commit: "source",
      packaging_commit: "packaging",
      validation_file: validationFile,
      runtime: "docker",
      conductor_run_id: "run-reconcile",
      output_file: outputFile,
    }),
  );

  try {
    const result = await reconcilePendingImagePublication(
      pendingFile,
      async () => ({
        stdout: "ghcr.io/eliware/ubuntu24-gluster@sha256:published-digest\n",
      }),
    );
    expect(result).toMatchObject({
      image: "ghcr.io/eliware/ubuntu24-gluster:11.2",
      digest: "sha256:published-digest",
      container_validation: { passed: true },
    });
    await expect(readFile(pendingFile, "utf8")).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
