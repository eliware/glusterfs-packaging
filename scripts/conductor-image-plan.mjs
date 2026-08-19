import { env, exists } from "./lib.mjs";
import { imageTargetsForLane } from "./lane-config.mjs";
import { publicationFile } from "./publication-paths.mjs";

export async function logPlannedImages({
  checkpoint,
  imageInputsMatch,
  lane,
  log,
}) {
  for (const [distribution, baseKey, repositoryName] of imageTargetsForLane(
    lane,
  )) {
    const imageCheckpoint = checkpoint.images?.[distribution];
    const imageProvenance =
      imageCheckpoint?.provenance || imageCheckpoint?.result?.provenance;
    const imageProvenanceExists = imageProvenance
      ? await exists(
          publicationFile(
            env("PUBLISH_ROOT", "/var/lib/gluster-packaging/repository"),
            imageProvenance,
          ),
        )
      : false;
    const image = `ghcr.io/eliware/${repositoryName}:${lane.version}`;
    log(
      `${lane.id}: image ${
        imageInputsMatch({
          checkpoint: imageCheckpoint,
          lane,
          distribution,
          baseKey,
          packageCandidate:
            checkpoint.package?.candidate_id ||
            checkpoint.package_candidate ||
            `${lane.id}-${lane.version}`,
          provenanceExists: imageProvenanceExists,
        })
          ? "skipped"
          : "planned"
      }`,
      `${distribution} ${image}`,
    );
  }
}
