import { fetchCatalog } from "./api.mjs";
import { getElement } from "./dom.mjs";
import { formatDateTime } from "./format.mjs";

const supportedDistributions = [
  ["centos-stream-10", "CentOS Stream 10"],
  ["rocky-10", "Rocky Linux 10"],
  ["almalinux-10", "AlmaLinux 10"],
  ["oracle-linux-10", "Oracle Linux 10"],
  ["debian-bookworm", "Debian 12 (bookworm)"],
  ["ubuntu-noble", "Ubuntu 24.04 (noble)"],
];

function statusIcon(status) {
  if (status === "passed") return '<span class="validation-icon pass">✓</span>';
  if (status === "failed") return '<span class="validation-icon fail">✕</span>';
  return '<span class="validation-icon skip">—</span>';
}

function metadataStatus(result) {
  return typeof result === "string" ? result : result?.status;
}

function canonicalDistributionId(id) {
  return (
    {
      debian: "debian-bookworm",
      ubuntu: "ubuntu-noble",
    }[id] || id
  );
}

export async function initValidationMatrix() {
  const body = getElement("validation-rows");
  if (!body) return;
  try {
    const catalog = await fetchCatalog();
    const validation = catalog.stable?.validation;
    const containerValidations = [
      catalog.stable?.container_validation,
      ...(catalog.images || []).map((item) => item.container_validation),
    ].filter(Boolean);
    const containerValidation = containerValidations[0];
    body.innerHTML = supportedDistributions
      .map(([id, label]) => {
        const rpm = validation?.distributions?.find(
          (candidate) => canonicalDistributionId(candidate.id) === id,
        );
        const container = containerValidations
          .flatMap((candidate) => candidate.distributions || [])
          .find((candidate) => canonicalDistributionId(candidate.id) === id);
        const containerRecord = containerValidations.find((candidate) =>
          (candidate.distributions || []).some(
            (item) => canonicalDistributionId(item.id) === id,
          ),
        );
        const packageResult = rpm?.package_core || rpm?.core;
        const repositoryResult =
          rpm?.repository_integrity ||
          rpm?.integrity ||
          container?.repository_integrity ||
          (rpm ? validation?.repository_integrity : null) ||
          containerRecord?.repository_integrity;
        const provenanceResult =
          rpm?.provenance ||
          rpm?.provenance_verification ||
          container?.provenance ||
          (rpm ? validation?.provenance_verification : null) ||
          containerRecord?.provenance_verification ||
          containerRecord?.provenance;
        return `<tr><th scope="row">${label}</th><td>${statusIcon(packageResult?.status)}</td><td>${statusIcon((container?.container_core || container?.core)?.status)}</td><td>${statusIcon(metadataStatus(repositoryResult))}</td><td>${statusIcon(metadataStatus(provenanceResult))}</td></tr>`;
      })
      .join("");
    const checks = getElement("validation-checks");
    if (checks)
      checks.textContent = `Package, container, repository, and provenance checks · Results from ${formatDateTime(validation?.generated || containerValidation?.generated)}`;
  } catch {
    body.innerHTML =
      '<tr><td colspan="5">Validation metadata is temporarily unavailable.</td></tr>';
  }
}
