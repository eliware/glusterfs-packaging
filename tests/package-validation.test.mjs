import {
  mergePackageValidation,
  mergePackageSmoke2Records,
  packageSmoke2Passed,
  packageSmoke2Complete,
  packageSmoke2Targets,
} from "../scripts/package-validation.mjs";

const passed = (id) => ({
  target_os: id,
  validation: {
    distributions: [{ id, package_core: { status: "passed" } }],
  },
});

test("RPM smoke-2 requires all four EL10 targets", () => {
  const lane = { format: "rpm" };
  expect(packageSmoke2Targets(lane)).toHaveLength(4);
  expect(
    packageSmoke2Complete({ smoke2: [passed("centos-stream-10")] }, lane),
  ).toBe(false);
  expect(
    packageSmoke2Complete(
      {
        smoke2: packageSmoke2Targets(lane).map(passed),
      },
      lane,
    ),
  ).toBe(true);
});

test("DEB smoke-2 is independent per target OS", () => {
  const lane = { format: "deb", distribution: "ubuntu" };
  expect(packageSmoke2Targets(lane)).toEqual(["ubuntu-noble"]);
  expect(
    packageSmoke2Complete({ smoke2: [passed("ubuntu-noble")] }, lane),
  ).toBe(true);
  expect(
    packageSmoke2Complete({ smoke2: [passed("debian-bookworm")] }, lane),
  ).toBe(false);
});

test("merged validation records smoke stages and target results", () => {
  const merged = mergePackageValidation(
    {
      distributions: [
        { id: "centos-stream-10", package_core: { status: "passed" } },
      ],
    },
    [passed("rocky-10"), passed("almalinux-10")],
  );
  expect(merged.smoke_stages.smoke1.status).toBe("passed");
  expect(merged.smoke_stages.smoke2.targets).toEqual([
    "rocky-10",
    "almalinux-10",
  ]);
  expect(merged.distributions.map(({ id }) => id)).toEqual([
    "centos-stream-10",
    "rocky-10",
    "almalinux-10",
  ]);
});

test("smoke-2 records can resume with only incomplete targets", () => {
  const lane = { format: "rpm" };
  const first = passed("centos-stream-10");
  const merged = mergePackageSmoke2Records(lane, [first]);
  expect(packageSmoke2Passed(first, "centos-stream-10")).toBe(true);
  expect(packageSmoke2Passed(first, "rocky-10")).toBe(false);
  expect(merged.map(({ target_os }) => target_os)).toEqual([
    "centos-stream-10",
  ]);
  expect(
    mergePackageSmoke2Records(lane, [first], [passed("rocky-10")]).map(
      ({ target_os }) => target_os,
    ),
  ).toEqual(["centos-stream-10", "rocky-10"]);
});
