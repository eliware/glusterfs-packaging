export const EPEL_IMAGE_TARGETS = [
  { distribution: "centos-stream", baseKey: "centos", repositoryName: "centos10-gluster", required: true },
  { distribution: "rocky", baseKey: "rocky", repositoryName: "rocky10-gluster", required: false },
  { distribution: "alma", baseKey: "alma", repositoryName: "alma10-gluster", required: false },
  { distribution: "oracle", baseKey: "oracle", repositoryName: "oracle10-gluster", required: false },
];

export function buildLanes({ stableTag, sourceCommit, rollingCommit, date }) {
  const stableVersion = stableTag.slice(1);
  const rollingVersion = `${date}-${rollingCommit.slice(0, 12)}`;
  return [
    {
      id: "epel10-stable",
      format: "rpm",
      channel: "stable",
      distribution: "epel10",
      baseKey: "centos",
      sourceRef: stableTag,
      sourceCommit,
      version: stableVersion,
      packageVersion: stableVersion,
      workflow: "rpm-package-build.yml",
    },
    {
      id: "debian-stable",
      format: "deb",
      channel: "stable",
      distribution: "debian",
      suite: "bookworm",
      baseKey: "debian",
      sourceRef: stableTag,
      sourceCommit,
      version: stableVersion,
      packageVersion: `${stableVersion}-5eliware1`,
      workflow: "deb-package-build.yml",
    },
    {
      id: "ubuntu-stable",
      format: "deb",
      channel: "stable",
      distribution: "ubuntu",
      suite: "noble",
      baseKey: "ubuntu",
      sourceRef: stableTag,
      sourceCommit,
      version: stableVersion,
      packageVersion: `${stableVersion}-5eliware1`,
      workflow: "deb-package-build.yml",
    },
    {
      id: "epel10-rolling",
      format: "rpm",
      channel: "preview",
      distribution: "epel10",
      baseKey: "centos",
      sourceRef: "devel",
      sourceCommit: rollingCommit,
      version: rollingVersion,
      packageVersion: `${date}-0.git${rollingCommit.slice(0, 12)}`,
      workflow: "rpm-package-build.yml",
      imageTargets: EPEL_IMAGE_TARGETS,
    },
    {
      id: "debian-rolling",
      format: "deb",
      channel: "preview",
      distribution: "debian",
      suite: "bookworm",
      baseKey: "debian",
      sourceRef: "devel",
      sourceCommit: rollingCommit,
      version: rollingVersion,
      packageVersion: `${date}~rolling.g${rollingCommit.slice(0, 12)}-1`,
      workflow: "deb-package-build.yml",
    },
    {
      id: "ubuntu-rolling",
      format: "deb",
      channel: "preview",
      distribution: "ubuntu",
      suite: "noble",
      baseKey: "ubuntu",
      sourceRef: "devel",
      sourceCommit: rollingCommit,
      version: rollingVersion,
      packageVersion: `${date}~rolling.g${rollingCommit.slice(0, 12)}-1`,
      workflow: "deb-package-build.yml",
    },
  ];
}

export function imageTargetsForLane(lane) {
  if (lane.format === "rpm")
    return (lane.imageTargets || EPEL_IMAGE_TARGETS).map(
      ({ distribution, baseKey, repositoryName }) => [
        distribution,
        baseKey,
        repositoryName,
      ],
    );
  return lane.distribution === "debian"
    ? [["debian", "debian", "debian12-gluster"]]
    : [["ubuntu", "ubuntu", "ubuntu24-gluster"]];
}

export function hasRequiredImageFailure(lane, failures = []) {
  const required = new Set(
    (lane.imageTargets || EPEL_IMAGE_TARGETS)
      .filter((target) => target.required)
      .map((target) => target.distribution),
  );
  return failures.some((failure) => required.has(failure.distribution));
}
