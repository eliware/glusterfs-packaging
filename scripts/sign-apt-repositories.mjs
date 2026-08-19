#!/usr/bin/env node
import path from "node:path";
import { exists, env, run } from "./lib.mjs";
import { readdir } from "node:fs/promises";

const root = process.argv[2] || env("DEB_ROOT", "");
const key = env("APT_SIGNING_KEY", env("RPM_SIGNING_KEY", ""));
if (!root) throw new Error("DEB_ROOT is required");
if (!key) throw new Error("APT_SIGNING_KEY or RPM_SIGNING_KEY is required");
const passphrase = env(
  "APT_SIGNING_PASSPHRASE_FILE",
  env("RPM_SIGNING_PASSPHRASE_FILE", ""),
);
const extra = passphrase
  ? ["--no-tty", "--pinentry-mode", "loopback", "--passphrase-file", passphrase]
  : ["--no-tty", "--pinentry-mode", "loopback"];
const signingEnv = { ...process.env };
delete signingEnv.GPG_TTY;

async function sign(directory) {
  const release = path.join(directory, "dists/stable/Release");
  if (!(await exists(release))) return;
  await run("gpg", [
    "--batch",
    "--yes",
    ...extra,
    "--clearsign",
    "--local-user",
    key,
    "--output",
    path.join(directory, "dists/stable/InRelease"),
    release,
  ], { env: signingEnv });
  await run("gpg", [
    "--batch",
    "--yes",
    ...extra,
    "--armor",
    "--detach-sign",
    "--local-user",
    key,
    "--output",
    path.join(directory, "dists/stable/Release.gpg"),
    release,
  ], { env: signingEnv });
}

for (const distribution of await readdir(root)) {
  const distributionRoot = path.join(root, distribution);
  for (const suite of await readdir(distributionRoot)) {
    const suiteRoot = path.join(distributionRoot, suite);
    for (const architecture of await readdir(suiteRoot))
      await sign(
        path.join(
          suiteRoot,
          architecture,
          process.env.RELEASE_VERSION || "11.2",
        ),
      );
  }
}
console.log("Signed Debian-family repository metadata");
