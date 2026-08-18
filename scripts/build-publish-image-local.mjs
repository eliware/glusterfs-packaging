#!/usr/bin/env node
import path from "node:path";
import { env, repoRoot, run, runInteractive, tempDir } from "./lib.mjs";
import { required } from "./local-image-config.mjs";
import { buildLocalImage } from "./local-image-build.mjs";
import { smokeTestLocalImage } from "./local-image-smoke.mjs";
import { publishLocalImage } from "./local-image-publish.mjs";
import {
  writeLocalImageResult,
  writePendingImagePublication,
} from "./local-image-result.mjs";

const outputFile = required("IMAGE_RESULT", env("IMAGE_RESULT"));
const config = {
  image: required("IMAGE", env("IMAGE")),
  packageFormat: required("PACKAGE_FORMAT", env("PACKAGE_FORMAT")),
  distribution: required("DISTRIBUTION", env("DISTRIBUTION")),
  dockerfile: required("DOCKERFILE", env("DOCKERFILE")),
  baseImage: required("BASE_IMAGE", env("BASE_IMAGE")),
  baseImageDigest: required("BASE_IMAGE_DIGEST", env("BASE_IMAGE_DIGEST")),
  version: required("VERSION", env("VERSION")),
  packagingCommit: required("PACKAGING_COMMIT", env("PACKAGING_COMMIT")),
  sourceRef: required("SOURCE_REF", env("SOURCE_REF")),
  sourceCommit: required("SOURCE_COMMIT", env("SOURCE_COMMIT")),
  packageCandidate: required("PACKAGE_CANDIDATE", env("PACKAGE_CANDIDATE")),
  packageProvenance: required("PACKAGE_PROVENANCE", env("PACKAGE_PROVENANCE")),
  outputFile,
  buildLog: env(
    "IMAGE_BUILD_LOG",
    path.join(path.dirname(outputFile), "image-build.log"),
  ),
  runtime: env("CONTAINER_RUNTIME", "docker"),
  conductorRunId: required("CONDUCTOR_RUN_ID", env("CONDUCTOR_RUN_ID")),
  aliases: env("IMAGE_ALIASES")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  publishImage: env("PUBLISH_IMAGE", "1") === "1",
  repoRoot,
  rpmRepoUrl: env("RPM_REPO_URL"),
  rpmMetadataSha256: env("RPM_METADATA_SHA256"),
  debRepoUrl: env("DEB_REPO_URL"),
  publicationStateFile: env("IMAGE_PUBLICATION_STATE", `${outputFile}.pending`),
  run,
};

config.log = console.log;
config.loggedRun = (command, args, options = {}) =>
  run(command, args, {
    ...options,
    stream: true,
    logFile: config.buildLog,
    silent: true,
    captureStream: false,
  });
config.loggedInteractive = (command, args, options = {}) =>
  runInteractive(command, args, {
    ...options,
    logFile: config.buildLog,
    silent: true,
  });
config.publishScript = path.join(repoRoot, "scripts/publish-image.mjs");

await buildLocalImage(config);
const work = await tempDir("gluster-image-");
config.validationFile = path.join(work, "container-validation.json");
try {
  await smokeTestLocalImage(config);
  if (config.publishImage) await writePendingImagePublication(config);
  await publishLocalImage(config);
  await writeLocalImageResult(config);
} finally {
  await run("rm", ["-rf", "--", work], { capture: true }).catch(() => {});
}
