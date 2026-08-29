import path from "node:path";
import { exists } from "./lib.mjs";
import { assertMetadataDocument } from "./metadata-version.mjs";
import { readMetadata } from "./metadata-io.mjs";
import { assertValidationRecord } from "./validation-schema.mjs";
import { findReleaseConsistencyIssues } from "./release-consistency.mjs";
import { publicationFile } from "./publication-paths.mjs";

export async function validatePublishedArtifacts({
  results,
  lanes,
  publicationRoot,
  publishedPackageRoot,
  log,
}) {
  const catalogPath = path.join(publicationRoot, "metadata/catalog.json");
  const catalog = await readMetadata(catalogPath, {
    required: ["schema", "stable", "preview", "packages", "images"],
  });
  const failures = [];
  const consistencyCheckpoints = Object.fromEntries(
    results.flatMap((result, index) =>
      result.status === "fulfilled" ? [[lanes[index].id, result.value]] : [],
    ),
  );
  failures.push(
    ...findReleaseConsistencyIssues({
      checkpoints: consistencyCheckpoints,
      catalog,
    }),
  );
  const checkMetadata = async (file, label, required) => {
    try {
      const document = await readMetadata(file, { label, required });
      const documentRunId = document.run_id || document.record?.run_id;
      if (!documentRunId) failures.push(`${label}: missing run_id`);
      return document;
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
      return null;
    }
  };
  for (let index = 0; index < lanes.length; index += 1) {
    const lane = lanes[index];
    const outcome = results[index];
    if (outcome.status !== "fulfilled") {
      failures.push(
        `${lane.id}: lane did not complete successfully: ${outcome.reason?.message || String(outcome.reason)}`,
      );
      continue;
    }
    const value = outcome.value;
    const packageRoot =
      value.package?.published_root || publishedPackageRoot(lane);
    const packageMetadata = path.join(
      packageRoot,
      lane.format === "rpm" ? "repodata/repomd.xml" : "dists/stable/Release",
    );
    if (!(await exists(packageMetadata)))
      failures.push(`${lane.id}: missing published package metadata`);
    const packageRecord = value.package;
    if (!packageRecord?.provenance)
      failures.push(`${lane.id}: missing package provenance link`);
    else {
      const packageProvenance = await checkMetadata(
        publicationFile(publicationRoot, packageRecord.provenance),
        `${lane.id} package provenance`,
        ["schema", "record", "files", "checksums_sha256"],
      );
      if (packageProvenance?.record?.run_id === null)
        failures.push(`${lane.id}: package provenance run_id is null`);
    }
    try {
      assertMetadataDocument(value.smoke, `${lane.id} package validation`, [
        "run_id",
        "checks",
        "distributions",
      ]);
      assertValidationRecord(value.smoke, {
        coreField: "package_core",
        label: `${lane.id} package`,
      });
    } catch (error) {
      failures.push(`${lane.id}: ${error.message}`);
    }
    const expectedImages =
      lane.format === "rpm"
        ? ["centos-stream", "rocky", "alma", "oracle"]
        : [lane.distribution];
    for (const distribution of expectedImages) {
      const imageFailure = value.image_failures?.find(
        (failure) => failure.distribution === distribution,
      );
      if (imageFailure) {
        if (!imageFailure.provenance)
          failures.push(
            `${lane.id}/${distribution}: missing image failure provenance`,
          );
        else
          await checkMetadata(
            publicationFile(publicationRoot, imageFailure.provenance),
            `${lane.id}/${distribution} image failure provenance`,
            ["schema", "record", "files", "checksums_sha256"],
          );
        continue;
      }
      const image = value.images?.[distribution];
      if (!image?.provenance)
        failures.push(`${lane.id}/${distribution}: missing image provenance`);
      else
        await checkMetadata(
          publicationFile(publicationRoot, image.provenance),
          `${lane.id}/${distribution} image provenance`,
          ["schema", "record", "files", "checksums_sha256"],
        );
      const imageResult =
        value.image_results?.find(
          (item) => item.distribution === distribution,
        ) || image?.result;
      if (!imageResult?.digest?.startsWith("sha256:"))
        failures.push(`${lane.id}/${distribution}: missing image digest`);
      try {
        assertMetadataDocument(
          imageResult?.container_validation,
          `${lane.id}/${distribution} container validation`,
          ["run_id", "checks", "distributions"],
        );
        assertValidationRecord(imageResult.container_validation, {
          coreField: "container_core",
          label: `${lane.id}/${distribution} container`,
        });
      } catch (error) {
        failures.push(`${lane.id}/${distribution}: ${error.message}`);
      }
      if (
        !catalog.images.some(
          (record) => record.image?.digest === imageResult?.digest,
        )
      )
        failures.push(
          `${lane.id}/${distribution}: missing catalog image record`,
        );
    }
  }
  if (failures.length)
    throw new Error(
      `final publication validation failed: ${failures.join("; ")}`,
    );
  log("final publication validation passed", `${lanes.length} lanes`);
}
