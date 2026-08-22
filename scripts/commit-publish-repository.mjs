#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { env, run } from "./lib.mjs";

const repositoryRoot = env(
  "GLUSTER_REPOSITORY_ROOT",
  "/mnt/pvc/gluster-repository-http",
);
const remote = env("REPOSITORY_GIT_REMOTE", "origin");
const configuredBranch = env("REPOSITORY_GIT_BRANCH", "");
const userName = env("REPOSITORY_GIT_USER_NAME", "Eliware");
const userEmail = env(
  "REPOSITORY_GIT_USER_EMAIL",
  "github-actions[bot]@users.noreply.github.com",
);

const git = (args, options = {}) =>
  run("git", args, { cwd: repositoryRoot, capture: true, ...options });

const status = await git(["status", "--porcelain=v1"]);
if (!status.stdout.trim()) {
  console.log("[repo-git] repository is clean; nothing to commit");
  process.exit(0);
}

const branch =
  configuredBranch ||
  (await git(["symbolic-ref", "--quiet", "--short", "HEAD"])).stdout.trim();
if (!branch)
  throw new Error("repository HEAD is detached; set REPOSITORY_GIT_BRANCH");

let generation = "unknown";
try {
  const generations = await readdir(path.join(repositoryRoot, ".generations"));
  generation =
    generations
      .filter((name) => /^\d{8}T[^-]+-.+$/.test(name))
      .sort()
      .at(-1) || generation;
} catch {
  /* Fall back to active metadata when generations are unavailable. */
}
try {
  const active = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "metadata", "active-generation.json"),
      "utf8",
    ),
  );
  if (generation === "unknown") generation = active.generation || generation;
} catch {
  /* The Git snapshot remains useful even if generation metadata is absent. */
}

await git(["add", "--all"]);
await git(
  [
    "-c",
    `user.name=${userName}`,
    "-c",
    `user.email=${userEmail}`,
    "commit",
    "-m",
    `Publish repository generation ${generation}`,
  ],
  { capture: false },
);
await git(["push", remote, `${branch}:${branch}`], { capture: false });
console.log(`[repo-git] committed and pushed generation ${generation}`);
