import {
  publicationFile,
  publicationRelativePath,
} from "../scripts/publication-paths.mjs";

test.each([
  [
    "/metadata/runs/run/image/provenance.json",
    "metadata/runs/run/image/provenance.json",
  ],
  [
    "https://glusterfs.eliware.org/metadata/runs/run/image/provenance.json",
    "metadata/runs/run/image/provenance.json",
  ],
])("normalizes publication reference %s", (reference, expected) => {
  expect(publicationRelativePath(reference)).toBe(expected);
});

test("resolves a normalized publication file beneath the repository root", () => {
  expect(
    publicationFile(
      "/var/lib/gluster-packaging/repository",
      "/metadata/runs/run/provenance.json",
    ),
  ).toBe(
    "/var/lib/gluster-packaging/repository/metadata/runs/run/provenance.json",
  );
});

test("rejects path traversal", () => {
  expect(() => publicationRelativePath("/metadata/../secret")).toThrow(
    "invalid publication path",
  );
});
