const flagOptions = new Set([
  "dry-run",
  "force",
  "help",
  "no-publish",
  "no-rebuild",
  "wet-run",
]);

export const CONDUCTOR_HELP = `Usage: node scripts/conductor.mjs MODE [OPTIONS]

Modes:
  --dry-run                 Verify upstream inputs and report planned work;
                            never build, publish, or update checkpoints.
  --wet-run                 Perform the complete build, validation, and
                            publication pipeline.

Options:
  --help                    Show this help text.
  --force                   Ignore valid checkpoints and rebuild lanes.
  --no-publish              Build and validate without publishing artifacts.
  --no-rebuild              Fail if a required package checkpoint is missing.
  --gh-path PATH            Use PATH as the gh executable or mock.
  --candidate-path PATH     Override the conductor workspace root.
  --repo-path PATH          Override the publication root.

Running without arguments shows this help and performs no work.`;

export function parseConductorCliArgs(argv) {
  const cliArgs = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--"))
      throw new Error(`unexpected conductor argument: ${argument}`);
    const name = argument.slice(2);
    if (flagOptions.has(name)) {
      cliArgs.set(name, true);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`missing value for --${name}`);
    cliArgs.set(name, value);
    index += 1;
  }

  const helpRequested = argv.length === 2 || cliArgs.has("help");
  if (!helpRequested && cliArgs.has("dry-run") === cliArgs.has("wet-run"))
    throw new Error(
      "choose exactly one conductor mode: --dry-run or --wet-run",
    );

  return {
    cliArgs,
    dryRun: cliArgs.has("dry-run"),
    force: cliArgs.has("force"),
    helpRequested,
    noRebuild: cliArgs.has("no-rebuild"),
    skipPublication: cliArgs.has("no-publish"),
  };
}
