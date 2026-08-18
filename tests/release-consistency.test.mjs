import { findReleaseConsistencyIssues } from "../scripts/release-consistency.mjs";

const validState = () => ({
  checkpoints: {
    "debian-stable": {
      status: "published",
      package: {
        candidate_id: "debian-stable-11.2",
        provenance: "/debian/bookworm/stable/provenance.json",
      },
      images: {
        debian: {
          status: "published",
          provenance: "/metadata/runs/run/image-debian/provenance.json",
          result: {
            image: "ghcr.io/eliware/debian12-gluster:11.2",
            digest: "sha256:image",
          },
        },
      },
    },
  },
  catalog: {
    packages: [{ candidate: "debian-stable-11.2" }],
    images: [
      {
        image: {
          digest: "sha256:image",
          provenance: {
            url: "/metadata/runs/run/image-debian/provenance.json",
          },
        },
      },
    ],
  },
  report: {
    lanes_successful: 1,
    lanes_total: 1,
    image_count: 1,
    platforms: [{ images: [{ digest: "sha256:image" }] }],
  },
  provenanceDocuments: {
    "/debian/bookworm/stable/provenance.json": {},
    "/metadata/runs/run/image-debian/provenance.json": {},
  },
});

test("accepts consistent checkpoint, catalog, provenance, image, and report data", () => {
  expect(findReleaseConsistencyIssues(validState())).toEqual([]);
});

test("reports missing image and provenance linkage", () => {
  const state = validState();
  state.catalog.images[0].image.digest = "sha256:other";
  delete state.provenanceDocuments[
    "/metadata/runs/run/image-debian/provenance.json"
  ];
  expect(findReleaseConsistencyIssues(state)).toEqual(
    expect.arrayContaining([
      "debian-stable/debian: missing catalog image record",
    ]),
  );
});
