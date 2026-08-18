#!/usr/bin/env node
import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  env,
  exists,
  parseEnvFile,
  repoRoot,
  remove,
  runInteractive,
} from "./lib.mjs";
const configFile = env(
  "BUILD_CONFIG",
  path.join(repoRoot, "build-config/el10-x86_64.env"),
);
if (!(await exists(configFile)))
  throw new Error(`build config does not exist: ${configFile}`);
const config = { ...(await parseEnvFile(configFile)), ...process.env };
const workspace = env("WORKSPACE_ROOT", "/workspaces/stable");
const version = config.GLUSTER_VERSION;
const output = env(
  "OUTPUT_DIR",
  path.join(repoRoot, `artifacts/el10/x86_64/${version}`),
);
const stable = env(
  "STABLE_DIR",
  path.join(repoRoot, "artifacts/el10/x86_64/stable"),
);
const sourceWorktree = env(
  "SOURCE_DIR",
  path.join(workspace, "source-worktree"),
);
if (!(await exists(repoRoot)))
  throw new Error(`packaging checkout does not exist: ${repoRoot}`);
if (env("CLEAN_BUILD", "0") === "1") {
  await remove(sourceWorktree);
  await remove(path.join(workspace, "selinux-source"));
  await remove(output);
  await remove(stable);
}
const ccacheDir = env(
  "CCACHE_DIR",
  path.join(path.dirname(workspace), "ccache"),
);
await mkdir(ccacheDir, { recursive: true });
const common = {
  ...process.env,
  REPO_ROOT: repoRoot,
  BUILD_CONFIG: configFile,
  SOURCE_DIR: sourceWorktree,
  SOURCE_MAIN_DIR: env(
    "SOURCE_MAIN_DIR",
    path.join(path.dirname(workspace), "source-main"),
  ),
  SELINUX_SOURCE_DIR: path.join(workspace, "selinux-source"),
  CCACHE_DIR: ccacheDir,
  OUTPUT_DIR: output,
  SOURCE_REF: env("SOURCE_REF", config.GLUSTER_TAG),
  APPLY_PATCHES: env("APPLY_PATCHES", "1"),
};
if (env("FAST_CHECK_ONLY", "0") === "1")
  await runInteractive(
    "node",
    [path.join(repoRoot, "scripts/build-rpms.mjs")],
    { env: { ...common, BUILD_ONLY: "1" } },
  );
else {
  await runInteractive(
    "node",
    [path.join(repoRoot, "scripts/build-rpms.mjs")],
    { env: common },
  );
  await runInteractive(
    "node",
    [path.join(repoRoot, "scripts/make-repository.mjs"), output, stable],
    { env: common },
  );
}
console.log(`Incremental workspace build completed: ${workspace}`);
