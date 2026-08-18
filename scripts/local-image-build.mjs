import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { required } from "./local-image-config.mjs";

export function imageBuildArgs(config) {
  const args = [
    "build",
    "--file",
    config.dockerfile,
    "--tag",
    config.image,
    "--build-arg",
    `BASE_IMAGE=${config.baseImage}`,
    "--build-arg",
    `BASE_IMAGE_DIGEST=${config.baseImageDigest}`,
    "--build-arg",
    `DISTRIBUTION=${config.distribution}`,
    "--build-arg",
    `PACKAGING_COMMIT=${config.packagingCommit}`,
    "--build-arg",
    `SOURCE_REF=${config.sourceRef}`,
    "--build-arg",
    `SOURCE_COMMIT=${config.sourceCommit}`,
    "--build-arg",
    `PACKAGE_CANDIDATE=${config.packageCandidate}`,
    "--build-arg",
    `PACKAGE_PROVENANCE=${config.packageProvenance}`,
  ];
  if (config.packageFormat === "rpm") {
    args.push(
      "--build-arg",
      `RELEASE_VERSION=${config.version}`,
      "--build-arg",
      `RPM_REPO_URL=${required("RPM_REPO_URL", config.rpmRepoUrl)}`,
      "--build-arg",
      `RPM_METADATA_SHA256=${required("RPM_METADATA_SHA256", config.rpmMetadataSha256)}`,
    );
  } else if (config.packageFormat === "deb") {
    args.push(
      "--build-arg",
      `GLUSTER_VERSION=${config.version}`,
      "--build-arg",
      `DEB_REPO_URL=${required("DEB_REPO_URL", config.debRepoUrl)}`,
    );
  } else throw new Error(`unsupported package format: ${config.packageFormat}`);
  return args;
}

export async function buildLocalImage(config) {
  await mkdir(path.dirname(config.buildLog), { recursive: true });
  await writeFile(config.buildLog, "");
  config.log(`[local-image] building ${config.image} from ${config.baseImage}`);
  await config.loggedRun(config.runtime, [
    ...imageBuildArgs(config),
    config.repoRoot,
  ]);
}
