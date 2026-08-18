import path from "node:path";

export async function smokeTestLocalImage(config) {
  const smokeScript =
    config.packageFormat === "rpm"
      ? path.join(config.repoRoot, "tests/container-smoke.mjs")
      : path.join(config.repoRoot, "tests/container-smoke-deb.mjs");
  await config.loggedRun("node", [smokeScript], {
    env: {
      ...process.env,
      IMAGE_TAG: config.image,
      IMAGE: config.image,
      IMAGE_DISTRIBUTION: config.distribution,
      DISTRIBUTION: config.distribution,
      CONTAINER_VALIDATION_FILE: config.validationFile,
      CONTAINER_RUNTIME: config.runtime,
      CONDUCTOR_RUN_ID: config.conductorRunId,
    },
  });
  await config.loggedInteractive(
    "node",
    [path.join(config.repoRoot, "scripts/image-labels.mjs")],
    {
      env: {
        ...process.env,
        IMAGE: config.image,
        PACKAGE_FORMAT: config.packageFormat,
        VERSION: config.version,
        BASE_IMAGE: config.baseImage,
        BASE_IMAGE_DIGEST: config.baseImageDigest,
        DISTRIBUTION: config.distribution,
        PACKAGING_COMMIT: config.packagingCommit,
        SOURCE_REF: config.sourceRef,
        SOURCE_COMMIT: config.sourceCommit,
        PACKAGE_CANDIDATE: config.packageCandidate,
        PACKAGE_PROVENANCE: config.packageProvenance,
        RPM_REPO_URL: config.rpmRepoUrl,
        RPM_METADATA_SHA256: config.rpmMetadataSha256,
        DEB_REPO_URL: config.debRepoUrl,
        CONTAINER_VALIDATION_FILE: config.validationFile,
        CONTAINER_RUNTIME: config.runtime,
        CONDUCTOR_RUN_ID: config.conductorRunId,
      },
    },
  );
}
