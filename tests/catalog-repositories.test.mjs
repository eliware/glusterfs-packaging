import { catalogRepositoryLinks } from "../scripts/catalog-repositories.mjs";

test.each([
  ["stable", "/el10/x86_64/stable/"],
  ["preview", "/el10/x86_64/previews/rolling-abc/"],
])("builds only the RPM link for %s", (channel, expected) => {
  const links = catalogRepositoryLinks({
    packageFormat: "rpm",
    distribution: "epel10",
    channel,
    candidate: "rolling-abc",
  });
  expect(links).toEqual({
    rpm_repo: expected,
    repositories: { rpm: expected },
  });
  expect(links.deb_repos).toBeUndefined();
});

test.each([
  ["debian", "bookworm", "/debian/bookworm/amd64/stable/"],
  ["ubuntu", "noble", "/ubuntu/noble/amd64/previews/rolling-abc/"],
])("builds only the %s APT link", (distribution, suite, expected) => {
  const links = catalogRepositoryLinks({
    packageFormat: "deb",
    distribution,
    suite,
    channel: distribution === "ubuntu" ? "preview" : "stable",
    candidate: "rolling-abc",
  });
  expect(links).toEqual({
    deb_repos: { [distribution]: expected },
    repositories: { deb: expected },
  });
  expect(links.rpm_repo).toBeUndefined();
});

test("rejects an invalid Debian suite instead of generating a bad link", () => {
  expect(() =>
    catalogRepositoryLinks({
      packageFormat: "deb",
      distribution: "ubuntu",
      suite: "bookworm",
      candidate: "stable",
    }),
  ).toThrow("unsupported Debian distribution or suite");
});
