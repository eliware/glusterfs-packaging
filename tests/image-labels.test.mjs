import {
  expectedImageLabels,
  validateImageLabels,
} from "../scripts/image-labels.mjs";

const inputs = {
  packageFormat: "rpm",
  version: "11.2",
  baseImageReference: "quay.io/example:10@sha256:" + "b".repeat(64),
  baseImageDigest: "sha256:" + "a".repeat(64),
  distribution: "centos-stream",
  packagingCommit: "packaging-commit",
  sourceRef: "v11.2",
  sourceCommit: "source-commit",
  packageCandidate: "epel10-stable-11.2",
  packageProvenance: "https://example.test/provenance.json",
  repositoryUrl: "https://example.test/el10/x86_64/stable/",
  repositoryMetadataSha256: "metadata-sha256",
};

test("expected image labels cover immutable package and source inputs", () => {
  const labels = expectedImageLabels(inputs);
  expect(labels["org.eliware.gluster.package-candidate"]).toBe(
    inputs.packageCandidate,
  );
  expect(labels["org.eliware.gluster.rpm-metadata-sha256"]).toBe(
    inputs.repositoryMetadataSha256,
  );
});

test("image labels reject missing or mismatched values", () => {
  const expected = expectedImageLabels(inputs);
  expect(() => validateImageLabels({}, expected)).toThrow("missing=");
  expect(() =>
    validateImageLabels(
      { ...expected, "org.opencontainers.image.version": "wrong" },
      expected,
    ),
  ).toThrow("mismatched=org.opencontainers.image.version");
  expect(validateImageLabels(expected, expected)).toEqual(expected);
});
