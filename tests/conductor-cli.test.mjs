import {
  CONDUCTOR_HELP,
  parseConductorCliArgs,
} from "../scripts/conductor-cli.mjs";

test("requires an explicit mode when arguments are supplied", () => {
  expect(() =>
    parseConductorCliArgs(["node", "conductor.mjs", "--force"]),
  ).toThrow("choose exactly one conductor mode");
});

test("parses dry-run flags and valued options", () => {
  const result = parseConductorCliArgs([
    "node",
    "conductor.mjs",
    "--dry-run",
    "--repo-path",
    "/repo",
    "--no-rebuild",
  ]);
  expect(result.dryRun).toBe(true);
  expect(result.helpRequested).toBe(false);
  expect(result.noRebuild).toBe(true);
  expect(result.cliArgs.get("repo-path")).toBe("/repo");
});

test("parses wet-run mode and exposes stable help text", () => {
  const result = parseConductorCliArgs(["node", "conductor.mjs", "--wet-run"]);
  expect(result.dryRun).toBe(false);
  expect(result.helpRequested).toBe(false);
  expect(CONDUCTOR_HELP).toContain("--wet-run");
});

test("requests help without arguments", () => {
  expect(parseConductorCliArgs(["node", "conductor.mjs"]).helpRequested).toBe(
    true,
  );
});
