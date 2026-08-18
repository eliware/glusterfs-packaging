export const PACKAGE_CHECKS = [
  "install",
  "service_start",
  "volume_create_mount",
  "file_lifecycle",
  "volume_unmount_delete",
  "service_shutdown",
];

export const CONTAINER_CHECKS = [
  "install",
  "cli_available",
  "volume_create_mount",
  "file_lifecycle",
  "volume_unmount_delete",
  "service_shutdown",
  "image_labels",
];

export const LIFECYCLE_CHECKS = PACKAGE_CHECKS;

export function assertValidationRecord(record, { coreField, label }) {
  if (!record || typeof record !== "object")
    throw new Error(`${label} validation record is missing`);
  if (!record.checks || Array.isArray(record.checks))
    throw new Error(`${label} validation checks must be an object`);
  const requiredChecks =
    coreField === "container_core" ? CONTAINER_CHECKS : PACKAGE_CHECKS;
  for (const check of requiredChecks)
    if (record.checks[check]?.status !== "passed")
      throw new Error(
        `${label} validation check failed or is missing: ${check}`,
      );
  const distributions = Array.isArray(record.distributions)
    ? record.distributions
    : [];
  if (!distributions.length)
    throw new Error(`${label} validation has no distribution results`);
  if (
    distributions.some(
      (distribution) => distribution[coreField]?.status !== "passed",
    )
  )
    throw new Error(
      `${label} core validation did not pass for every distribution`,
    );
  return record;
}

export function markPublicationVerified(record, detail) {
  const repositoryIntegrity = {
    status: "passed",
    detail: detail || "published metadata and artifact signatures verified",
  };
  const provenanceVerification = {
    status: "passed",
    detail: "provenance generated, signed, and independently verified",
  };
  return {
    ...record,
    repository_integrity: repositoryIntegrity,
    provenance_verification: provenanceVerification,
    distributions: (record.distributions || []).map((distribution) => ({
      ...distribution,
      repository_integrity: repositoryIntegrity,
      provenance_verification: provenanceVerification,
    })),
  };
}
