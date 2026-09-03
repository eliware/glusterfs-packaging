const DEB_SUITES = {
  debian: "bookworm",
  ubuntu: "noble",
};

export function catalogRepositoryLinks({
  packageFormat,
  distribution,
  channel = "stable",
  candidate,
  suite = DEB_SUITES[distribution],
}) {
  if (!candidate) throw new Error("catalog repository candidate is required");
  const releasePath =
    channel === "preview" ? `previews/${candidate}` : "stable";
  if (packageFormat === "rpm") {
    if (!["epel10", "centos-stream", "rocky", "alma", "oracle"].includes(distribution))
      throw new Error(`unsupported RPM distribution: ${distribution}`);
    const rpm = `/el10/x86_64/${releasePath}/`;
    return { rpm_repo: rpm, repositories: { rpm } };
  }
  if (packageFormat !== "deb")
    throw new Error(`unsupported catalog package format: ${packageFormat}`);
  if (!suite || !DEB_SUITES[distribution] || suite !== DEB_SUITES[distribution])
    throw new Error(
      `unsupported Debian distribution or suite: ${distribution}/${suite}`,
    );
  const deb = `/${distribution}/${suite}/amd64/${releasePath}/`;
  return {
    deb_repos: { [distribution]: deb },
    repositories: { deb },
  };
}
