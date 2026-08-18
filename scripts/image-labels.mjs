#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { run } from "./lib.mjs";
import { assertMetadataVersion } from "./metadata-version.mjs";

export function expectedImageLabels({
  packageFormat,
  version,
  baseImageReference,
  baseImageDigest,
  distribution,
  packagingCommit,
  sourceRef,
  sourceCommit,
  packageCandidate,
  packageProvenance,
  repositoryUrl,
  repositoryMetadataSha256 = "",
}) {
  const labels = {
    "org.opencontainers.image.version": version,
    "org.opencontainers.image.revision": packagingCommit,
    "org.eliware.gluster.base-image.digest": baseImageDigest,
    "org.eliware.gluster.base-image.reference": baseImageReference,
    "org.eliware.gluster.source-ref": sourceRef,
    "org.eliware.gluster.source-commit": sourceCommit,
    "org.eliware.gluster.distribution": distribution,
    "org.eliware.gluster.package-candidate": packageCandidate,
    "org.eliware.gluster.package-provenance": packageProvenance,
  };
  if (packageFormat === "rpm") {
    labels["org.eliware.gluster.rpm-repository"] = repositoryUrl;
    labels["org.eliware.gluster.rpm-metadata-sha256"] =
      repositoryMetadataSha256;
  } else labels["org.eliware.gluster.deb-repository"] = repositoryUrl;
  return labels;
}

export function validateImageLabels(actual, expected) {
  const missing = [];
  const mismatched = [];
  for (const [name, value] of Object.entries(expected)) {
    if (!(name in actual)) missing.push(name);
    else if (String(actual[name]) !== String(value))
      mismatched.push({ name, expected: value, actual: actual[name] });
  }
  if (missing.length || mismatched.length) {
    const details = [
      missing.length ? `missing=${missing.join(",")}` : "",
      mismatched.length
        ? `mismatched=${mismatched.map(({ name }) => name).join(",")}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    throw new Error(`image labels failed validation: ${details}`);
  }
  return actual;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const image = process.env.IMAGE;
  const validationFile = process.env.CONTAINER_VALIDATION_FILE;
  if (!image || !validationFile)
    throw new Error("IMAGE and CONTAINER_VALIDATION_FILE are required");
  const inspect = await run(
    process.env.CONTAINER_RUNTIME || "docker",
    ["image", "inspect", "--format", "{{json .Config.Labels}}", image],
    { capture: true },
  );
  const actual = JSON.parse(inspect.stdout.trim());
  const expected = expectedImageLabels({
    packageFormat: process.env.PACKAGE_FORMAT,
    version: process.env.VERSION,
    baseImageReference: process.env.BASE_IMAGE,
    baseImageDigest: process.env.BASE_IMAGE_DIGEST,
    distribution: process.env.DISTRIBUTION,
    packagingCommit: process.env.PACKAGING_COMMIT,
    sourceRef: process.env.SOURCE_REF,
    sourceCommit: process.env.SOURCE_COMMIT,
    packageCandidate: process.env.PACKAGE_CANDIDATE,
    packageProvenance: process.env.PACKAGE_PROVENANCE,
    repositoryUrl:
      process.env.PACKAGE_FORMAT === "rpm"
        ? process.env.RPM_REPO_URL
        : process.env.DEB_REPO_URL,
    repositoryMetadataSha256: process.env.RPM_METADATA_SHA256,
  });
  validateImageLabels(actual, expected);
  const validation = JSON.parse(await readFile(validationFile, "utf8"));
  assertMetadataVersion(validation, validationFile);
  validation.checks = {
    ...validation.checks,
    image_labels: { status: "passed" },
  };
  validation.image_labels = {
    status: "passed",
    fields: Object.keys(expected),
  };
  await writeFile(validationFile, `${JSON.stringify(validation, null, 2)}\n`);
  console.log(`Validated ${Object.keys(expected).length} image labels`);
}
