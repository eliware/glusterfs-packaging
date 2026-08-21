import path from "node:path";
import { env } from "./lib.mjs";

export function createConductorConfig({
  cliArgs,
  cliNoRebuild,
  cliSkipPublication,
}) {
  if (cliArgs.get("gh-path")) process.env.GH_PATH = cliArgs.get("gh-path");
  if (cliArgs.get("candidate-path") || cliArgs.get("candidate"))
    process.env.CONDUCTOR_WORKSPACE_ROOT =
      cliArgs.get("candidate-path") || cliArgs.get("candidate");
  if (cliArgs.get("repo-path") || cliArgs.get("repo"))
    process.env.PUBLISH_ROOT = cliArgs.get("repo-path") || cliArgs.get("repo");

  const stateRoot = env(
    "CONDUCTOR_STATE_ROOT",
    "/mnt/pvc/gluster-build-workspaces/conductor",
  );
  const publicationRoot = env(
    "PUBLISH_ROOT",
    "/mnt/pvc/gluster-repository-http",
  );
  const workspaceRoot = env(
    "CONDUCTOR_WORKSPACE_ROOT",
    "/mnt/pvc/gluster-build-workspaces/conductor",
  );
  return {
    backupScript: env("CONDUCTOR_BACKUP_SCRIPT", ""),
    lockDir: path.join(stateRoot, "lock"),
    noRebuild: cliNoRebuild || env("CONDUCTOR_NO_REBUILD", "0") === "1",
    skipPublication:
      cliSkipPublication || env("CONDUCTOR_NO_PUBLISH", "0") === "1",
    // Checkpoints are published beside the artifacts so repository backups
    // capture the exact state used to produce them.  Keep the lock and
    // transient status files local to avoid exposing runtime coordination.
    stateFile: env(
      "CONDUCTOR_STATE_FILE",
      path.join(publicationRoot, "metadata", "conductor-state.json"),
    ),
    stateRoot,
    workspaceRoot,
  };
}
