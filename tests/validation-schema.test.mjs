import {
  CONTAINER_CHECKS,
  PACKAGE_CHECKS,
  markPublicationVerified,
  assertValidationRecord,
} from "../scripts/validation-schema.mjs";

const record = (checks, coreField) => ({
  checks: Object.fromEntries(
    checks.map((check) => [check, { status: "passed" }]),
  ),
  distributions: [{ [coreField]: { status: "passed" } }],
});

test("package validation requires service_start", () => {
  expect(() =>
    assertValidationRecord(
      record(
        PACKAGE_CHECKS.filter((check) => check !== "service_start"),
        "package_core",
      ),
      { coreField: "package_core", label: "package" },
    ),
  ).toThrow(/service_start/);
});

test("container validation requires cli_available instead of service_start", () => {
  const container = record(CONTAINER_CHECKS, "container_core");
  expect(() =>
    assertValidationRecord(container, {
      coreField: "container_core",
      label: "container",
    }),
  ).not.toThrow();
  delete container.checks.cli_available;
  container.checks.service_start = { status: "passed" };
  expect(() =>
    assertValidationRecord(container, {
      coreField: "container_core",
      label: "container",
    }),
  ).toThrow(/cli_available/);
});

test("publication verification is recorded for every distribution", () => {
  const verified = markPublicationVerified({
    checks: {
      install: { status: "passed" },
      service_start: { status: "passed" },
      volume_create_mount: { status: "passed" },
      file_lifecycle: { status: "passed" },
      volume_unmount_delete: { status: "passed" },
      service_shutdown: { status: "passed" },
    },
    distributions: [
      { id: "centos-stream-10", package_core: { status: "passed" } },
      { id: "rocky-10", package_core: { status: "passed" } },
    ],
  });

  assertValidationRecord(verified, {
    coreField: "package_core",
    label: "package",
  });
  for (const distribution of verified.distributions) {
    expect(distribution.repository_integrity).toEqual({
      status: "passed",
      detail: expect.any(String),
    });
    expect(distribution.provenance_verification).toEqual({
      status: "passed",
      detail: expect.any(String),
    });
  }
});
