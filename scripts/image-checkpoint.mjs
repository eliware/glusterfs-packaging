/**
 * Return whether a published image checkpoint exactly matches the inputs and
 * integrity requirements for the image it represents.
 *
 * This is deliberately strict: incomplete checkpoints are invalid and must
 * not be reused or inferred from another image or package lane.
 */
export function isImageCheckpointValid({
  checkpoint,
  lane,
  distribution,
  baseImage,
  packageCandidate,
  provenanceExists,
  force = false,
}) {
  if (force || !checkpoint || checkpoint.status !== "published") return false;
  const result = checkpoint.result;
  return Boolean(
    checkpoint.source_commit === lane.sourceCommit &&
    checkpoint.package_candidate === packageCandidate &&
    checkpoint.base_image === baseImage &&
    checkpoint.distribution === distribution &&
    checkpoint.provenance &&
    provenanceExists &&
    result?.image &&
    result.digest?.startsWith("sha256:") &&
    result.base_image === baseImage &&
    result.base_image_digest === baseImage.split("@").at(-1) &&
    result.distribution === distribution,
  );
}
