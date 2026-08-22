import {
  packagePublicationRelativePath,
  publicationFile,
  publicationRelativePath,
} from "../scripts/publication-paths.mjs";

test.each([
  ["rpm", "epel10", undefined, "el10/x86_64/previews/rolling-abc"],
  ["deb", "debian", "bookworm", "debian/bookworm/amd64/previews/rolling-abc"],
  ["deb", "ubuntu", "noble", "ubuntu/noble/amd64/previews/rolling-abc"],
])(
  "builds the %s preview publication path",
  (packageFormat, distribution, suite, expected) => {
    expect(
      packagePublicationRelativePath({
        packageFormat,
        distribution,
        suite,
        channel: "preview",
        candidate: "rolling-abc",
      }),
    ).toBe(expected);
  },
);

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
      "/mnt/pvc/gluster-repository-http",
      "/metadata/runs/run/provenance.json",
    ),
  ).toBe("/mnt/pvc/gluster-repository-http/metadata/runs/run/provenance.json");
});

test("rejects path traversal", () => {
  expect(() => publicationRelativePath("/metadata/../secret")).toThrow(
    "invalid publication path",
  );
});

test("rejects missing and empty publication references", () => {
  expect(() => publicationRelativePath()).toThrow(
    "publication path is required",
  );
  expect(() => publicationRelativePath("/")).toThrow(
    "invalid publication path",
  );
});
