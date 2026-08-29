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

test("release report retains successful images and records partial target failures", () => {
  const data = buildPlatformData([
    {
      id: "epel10-rolling",
      status: "partial",
      build: { package_format: "rpm", channel: "preview", version: "rolling" },
      images: {
        "centos-stream": {
          result: { distribution: "centos-stream", image: "centos", digest: "sha256:ok" },
        },
      },
      image_failures: [
        { distribution: "rocky", error: "EPEL metadata unavailable" },
      ],
    },
  ]);

  expect(data.platforms).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "centos-stream", images: [expect.anything()] }),
      expect.objectContaining({
        id: "rocky",
        failures: ["rocky: EPEL metadata unavailable"],
      }),
    ]),
  );
});
