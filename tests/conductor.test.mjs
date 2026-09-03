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

test("signs RPM candidate metadata before local smoke-2", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile("scripts/conductor.mjs", "utf8"),
  );
  expect(source.indexOf('"scripts/sign-repository.mjs"')).toBeLessThan(
    source.indexOf("runPackageSmoke2({"),
  );
  expect(source).toContain('log(`${lane.id}: package metadata signed`');
});
