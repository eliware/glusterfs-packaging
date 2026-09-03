import { assertScriptParses } from "./helpers/script-test.mjs";

test("conductor.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/conductor.mjs");
});

test("failure provenance helper receives its package candidate explicitly", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile("scripts/conductor.mjs", "utf8"),
  );
  expect(source).toContain("packageCandidate,\n    error,");
  expect(source).toContain("publishedCandidate,\n              error,");
});

test("keeps RPM signing after local smoke-2", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile("scripts/conductor.mjs", "utf8"),
  );
  expect(source.indexOf("runPackageSmoke2({")).toBeLessThan(
    source.indexOf('"scripts/publish-package-candidate.mjs"'),
  );
});
