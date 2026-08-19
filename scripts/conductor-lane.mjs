import path from "node:path";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

/**
 * Create the publication callback used by a lane's image stage.
 * Keeping catalog mutation here makes the lane coordinator responsible only
 * for deciding what to build and recording the result.
 */
export function createLaneImageRecorder({
  baseImages,
  enqueuePublication,
  lane,
  pathRoot,
  repoRoot,
  runId,
  runInteractive,
  tempDir,
  validationFile,
}) {
  return async function recordImage(
    imageResult,
    distribution,
    provenanceUrl,
    imageBaseKey,
    packageProvenanceUrl,
  ) {
    if (!imageResult?.image || !imageResult?.digest)
      throw new Error(
        `image workflow returned no immutable digest for ${distribution}`,
      );
    const active = JSON.parse(
      await readFile(
        path.join(pathRoot, "metadata/active-generation.json"),
        "utf8",
      ),
    );
    const output = path.join(
      pathRoot,
      "metadata",
      `catalog.json.${runId}-${lane.id}-${distribution}.next`,
    );
    const containerValidationDir = await tempDir(
      "gluster-container-validation-",
    );
    const containerValidationFile = path.join(
      containerValidationDir,
      "container-validation.json",
    );
    await writeFile(
      containerValidationFile,
      `${JSON.stringify(imageResult.container_validation, null, 2)}\n`,
    );
    try {
      await enqueuePublication(`${lane.id}/${distribution}`, async () => {
        await runInteractive(
          "node",
          [
            path.join(repoRoot, "scripts/write-catalog.mjs"),
            "--output",
            output,
            "--publish-root",
            pathRoot,
            "--channel",
            lane.channel,
            "--version",
            lane.version,
            "--built",
            new Date().toISOString(),
            "--image",
            imageResult.image,
            "--digest",
            imageResult.digest,
            "--candidate",
            `${lane.id}-${lane.version}`,
            "--package-candidate",
            `${lane.id}-${lane.version}`,
            "--generation",
            active.generation,
            "--source-ref",
            lane.sourceRef,
            "--source-commit",
            lane.sourceCommit,
            "--validation-file",
            validationFile,
            "--container-validation-file",
            containerValidationFile,
            "--distribution",
            distribution,
            "--provenance",
            provenanceUrl,
            "--package-provenance",
            packageProvenanceUrl,
            "--base-image-digest",
            imageResult.base_image_digest ||
              baseImages[imageBaseKey].split("@").at(-1),
            "--base-image",
            imageResult.base_image || baseImages[imageBaseKey],
          ],
          { env: process.env, silent: true },
        );
        await rename(output, path.join(pathRoot, "metadata/catalog.json"));
        await runInteractive(
          "node",
          [
            path.join(repoRoot, "scripts/generate-repository-index.mjs"),
            "--root",
            pathRoot,
          ],
          { silent: true },
        );
        await runInteractive(
          "node",
          [
            path.join(repoRoot, "scripts/write-release-manifest.mjs"),
            "--root",
            pathRoot,
            "--generation",
            active.generation,
          ],
          { silent: true },
        );
      });
    } finally {
      await rm(containerValidationDir, { recursive: true, force: true });
    }
  };
}
