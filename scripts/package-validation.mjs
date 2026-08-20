export function packageSmoke2Targets(lane) {
  return lane.format === "rpm"
    ? ["centos-stream-10", "rocky-10", "almalinux-10", "oracle-linux-10"]
    : [lane.distribution === "debian" ? "debian-bookworm" : "ubuntu-noble"];
}

export function packageCheckpointInputsMatch(checkpoint, lane) {
  return (
    checkpoint?.status === "published" &&
    checkpoint.source_commit === lane.sourceCommit &&
    typeof checkpoint.candidate_id === "string" &&
    checkpoint.candidate_id.length > 0 &&
    typeof checkpoint.provenance === "string" &&
    checkpoint.provenance.length > 0 &&
    packageSmoke2Complete(checkpoint, lane)
  );
}

export function packageCandidateForPublication(lane, packageCheckpoint, packageRecord) {
  return (
    packageCheckpoint?.candidate_id ||
    packageRecord?.candidate_id ||
    `${lane.id}-${lane.version}`
  );
}

export function attachPublishedPackageCheckpoint(checkpoint, packageCheckpoint) {
  return {
    ...checkpoint,
    package: packageCheckpoint,
  };
}

export function packageSmoke2Complete(checkpoint, lane) {
  const records = checkpoint?.smoke2 || [];
  const required = packageSmoke2Targets(lane);
  return (
    required.length === records.length &&
    required.every(
      (target) =>
        records
          .find((record) => record.target_os === target)
          ?.validation?.distributions?.some(
            (distribution) =>
              distribution.id === target &&
              distribution.package_core?.status === "passed",
          ) === true,
    )
  );
}

export function packageSmoke2Passed(record, target) {
  return (
    record?.target_os === target &&
    record.validation?.distributions?.some(
      (distribution) =>
        distribution.id === target &&
        distribution.package_core?.status === "passed",
    ) === true
  );
}

export function mergePackageSmoke2Records(lane, ...groups) {
  const records = new Map();
  for (const record of groups.flat())
    if (record?.target_os) records.set(record.target_os, record);
  return packageSmoke2Targets(lane)
    .filter((target) => records.has(target))
    .map((target) => records.get(target));
}

export function mergePackageValidation(smoke1, smoke2) {
  const distributions = new Map(
    (smoke1?.distributions || []).map((distribution) => [
      distribution.id,
      distribution,
    ]),
  );
  for (const record of smoke2)
    for (const distribution of record.validation?.distributions || [])
      distributions.set(distribution.id, distribution);
  return {
    ...smoke1,
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    smoke_stages: {
      smoke1: { status: "passed" },
      smoke2: {
        status: "passed",
        targets: smoke2.map((item) => item.target_os),
      },
    },
    distributions: [...distributions.values()],
  };
}
