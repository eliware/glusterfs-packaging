import { isImageCheckpointValid } from "../scripts/image-checkpoint.mjs";

const lane = (id, sourceCommit = "stable-source") => ({
  id,
  sourceCommit,
  version: id.endsWith("rolling") ? "2026.08.18-rolling" : "11.2",
});

const checkpoint = ({ laneId, distribution, baseImage, baseImageDigest, sourceCommit }) => ({
  status: "published",
  source_commit: sourceCommit,
  package_candidate: `${laneId}-11.2`,
  base_image: baseImage,
  base_image_digest: baseImageDigest,
  distribution,
  provenance: "/metadata/runs/run/provenance.json",
  result: {
    image: `ghcr.io/eliware/${distribution}10-gluster:11.2`,
    digest: "sha256:image-digest",
    base_image: baseImage,
    base_image_digest: baseImageDigest,
    distribution,
  },
});

test.each([
  [
    "stable",
    lane("epel10-stable"),
    "rocky",
    "rockylinux/rockylinux:10",
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "epel10-stable-11.2",
  ],
  [
    "rolling",
    lane("epel10-rolling", "rolling-source"),
    "rocky",
    "rockylinux/rockylinux:10",
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "epel10-rolling-11.2",
  ],
])(
  "accepts a canonical %s image checkpoint",
  (_channel, laneValue, distribution, baseImage, baseImageDigest, packageCandidate) => {
    const value = checkpoint({
      laneId: laneValue.id,
      distribution,
      baseImage,
      baseImageDigest,
      sourceCommit: laneValue.sourceCommit,
    });
    value.package_candidate = packageCandidate;
    expect(
      isImageCheckpointValid({
        checkpoint: value,
        lane: laneValue,
        distribution,
        baseImage,
        baseImageDigest,
        packageCandidate,
        provenanceExists: true,
      }),
    ).toBe(true);
  },
);

test("rejects an image checkpoint with another distribution's base image", () => {
  const laneValue = lane("epel10-stable");
  const baseImage = "rockylinux/rockylinux:10";
  const baseImageDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const value = checkpoint({
    laneId: laneValue.id,
    distribution: "rocky",
    baseImage,
    baseImageDigest,
    sourceCommit: laneValue.sourceCommit,
  });
  value.base_image = "quay.io/centos/centos:stream10@sha256:wrong";
  expect(
    isImageCheckpointValid({
      checkpoint: value,
      lane: laneValue,
      distribution: "rocky",
      baseImage,
      baseImageDigest,
      packageCandidate: "epel10-stable-11.2",
      provenanceExists: true,
    }),
  ).toBe(false);
});

test("rejects an image checkpoint with a missing package candidate", () => {
  const laneValue = lane("epel10-rolling", "rolling-source");
  const baseImage = "rockylinux/rockylinux:10";
  const baseImageDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const value = checkpoint({
    laneId: laneValue.id,
    distribution: "rocky",
    baseImage,
    baseImageDigest,
    sourceCommit: laneValue.sourceCommit,
  });
  delete value.package_candidate;
  expect(
    isImageCheckpointValid({
      checkpoint: value,
      lane: laneValue,
      distribution: "rocky",
      baseImage,
      baseImageDigest,
      packageCandidate: "epel10-rolling-11.2",
      provenanceExists: true,
    }),
  ).toBe(false);
});

test("does not reuse a failed target checkpoint", () => {
  const laneValue = lane("epel10-rolling", "rolling-source");
  const baseImage = "rockylinux/rockylinux:10";
  const baseImageDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  expect(
    isImageCheckpointValid({
      checkpoint: {
        status: "failed",
        source_commit: laneValue.sourceCommit,
        package_candidate: "epel10-rolling-11.2",
        base_image: baseImage,
        base_image_digest: baseImageDigest,
        distribution: "rocky",
        provenance: "/metadata/runs/run/failure/provenance.json",
      },
      lane: laneValue,
      distribution: "rocky",
      baseImage,
      baseImageDigest,
      packageCandidate: "epel10-rolling-11.2",
      provenanceExists: true,
    }),
  ).toBe(false);
});
