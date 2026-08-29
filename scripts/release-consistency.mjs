export function findReleaseConsistencyIssues({
  checkpoints = {},
  catalog = {},
  report = null,
  provenanceDocuments = null,
}) {
  const issues = [];
  const packageRecords = Array.isArray(catalog.packages)
    ? catalog.packages
    : [];
  const imageRecords = Array.isArray(catalog.images) ? catalog.images : [];
  const hasProvenance = (url) =>
    !provenanceDocuments || Object.hasOwn(provenanceDocuments, url);

  for (const [lane, checkpoint] of Object.entries(checkpoints)) {
    if (checkpoint?.status !== "published") continue;
    const packageCandidate = checkpoint.package?.candidate_id;
    if (
      !packageCandidate ||
      !packageRecords.some((record) => record.candidate === packageCandidate)
    )
      issues.push(`${lane}: missing catalog package record`);
    if (!checkpoint.package?.provenance)
      issues.push(`${lane}: missing package provenance`);
    else if (!hasProvenance(checkpoint.package.provenance))
      issues.push(`${lane}: missing package provenance document`);

    for (const [distribution, imageCheckpoint] of Object.entries(
      checkpoint.images || {},
    )) {
      if (imageCheckpoint?.status === "failed") continue;
      const image = imageCheckpoint.result || imageCheckpoint;
      if (!image.digest?.startsWith("sha256:")) {
        issues.push(`${lane}/${distribution}: missing image digest`);
        continue;
      }
      const catalogImage = imageRecords.find(
        (record) => record.image?.digest === image.digest,
      );
      if (!catalogImage) {
        issues.push(`${lane}/${distribution}: missing catalog image record`);
        continue;
      }
      const provenance =
        image.provenance ||
        imageCheckpoint.provenance ||
        catalogImage.image?.provenance?.url;
      if (!provenance)
        issues.push(`${lane}/${distribution}: missing image provenance`);
      else if (!hasProvenance(provenance))
        issues.push(
          `${lane}/${distribution}: missing image provenance document`,
        );
    }
  }

  if (report) {
    const reportImages = (report.platforms || []).flatMap(
      (platform) => platform.images || [],
    );
    if (report.image_count !== reportImages.length)
      issues.push("release report image_count does not match platform images");
    for (const image of reportImages) {
      if (
        image.digest &&
        !imageRecords.some((record) => record.image?.digest === image.digest)
      )
        issues.push(
          `release report image missing from catalog: ${image.digest}`,
        );
    }
    if (report.lanes_successful > report.lanes_total)
      issues.push("release report successful lanes exceed total lanes");
  }
  return issues;
}
