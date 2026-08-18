import { imageBuildArgs } from "../scripts/local-image-build.mjs";
import { aliasImageName } from "../scripts/local-image-publish.mjs";

const baseConfig = {
  image: "ghcr.io/eliware/centos10-gluster:11.2",
  dockerfile: "containers/centos10-gluster.Dockerfile",
  baseImage: "quay.io/centos/centos:stream10",
  baseImageDigest: "sha256:base",
  distribution: "centos-stream",
  packagingCommit: "packaging",
  sourceRef: "v11.2",
  sourceCommit: "source",
  packageCandidate: "candidate",
  packageProvenance: "provenance",
  version: "11.2",
  rpmRepoUrl: "https://example.test/el10",
  rpmMetadataSha256: "metadata",
};

test("build arguments preserve RPM metadata inputs", () => {
  const args = imageBuildArgs({ ...baseConfig, packageFormat: "rpm" });
  expect(args).toEqual(
    expect.arrayContaining([
      "--build-arg",
      "RELEASE_VERSION=11.2",
      "RPM_REPO_URL=https://example.test/el10",
      "RPM_METADATA_SHA256=metadata",
    ]),
  );
});

test("build arguments select DEB metadata inputs", () => {
  const args = imageBuildArgs({
    ...baseConfig,
    packageFormat: "deb",
    debRepoUrl: "https://example.test/debian",
  });
  expect(args).toEqual(
    expect.arrayContaining([
      "GLUSTER_VERSION=11.2",
      "DEB_REPO_URL=https://example.test/debian",
    ]),
  );
});

test("aliases retain the image repository and replace only its tag", () => {
  expect(aliasImageName(baseConfig.image, "latest")).toBe(
    "ghcr.io/eliware/centos10-gluster:latest",
  );
});
