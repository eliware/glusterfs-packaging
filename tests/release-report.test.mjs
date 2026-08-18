import { readFile } from "node:fs/promises";
import { buildPlatformData } from "../scripts/release-report.mjs";

test("release report aggregates package and image lanes by platform", () => {
  const data = buildPlatformData([
    {
      id: "epel10-stable",
      status: "published",
      source_commit: "abcdef1234567890",
      build: {
        package_format: "rpm",
        channel: "stable",
        version: "11.2",
        source_commit: "abcdef1234567890",
      },
      package: {
        validation: {
          checks: { install: { status: "passed" } },
        },
      },
      images: {
        "centos-stream": {
          result: {
            distribution: "centos-stream",
            image: "ghcr.io/eliware/centos10-gluster:11.2",
            container_validation: {
              checks: { cli_available: { status: "passed" } },
            },
          },
        },
      },
    },
  ]);

  expect(data.platforms).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "centos-stream",
        packages: [expect.objectContaining({ format: "RPM", version: "11.2" })],
        images: [
          expect.objectContaining({
            image: "ghcr.io/eliware/centos10-gluster:11.2",
          }),
        ],
      }),
      expect.objectContaining({
        id: "rocky",
        packages: [expect.objectContaining({ format: "RPM", version: "11.2" })],
      }),
    ]),
  );
  expect(data.validation).toEqual({ passed: 2, total: 2 });
});

test("public templates expose the latest social card", async () => {
  const [index, browse, directory] = await Promise.all([
    readFile("templates/index.html", "utf8"),
    readFile("templates/browse.html", "utf8"),
    readFile("templates/directory-listing.html", "utf8"),
  ]);
  expect(index).toContain("og:image:width");
  expect(index).toContain("/metadata/latest-release-card.png");
  expect(browse).toContain("twitter:card");
  expect(directory).toContain("{{OG_IMAGE}}");
});
