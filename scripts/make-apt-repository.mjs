#!/usr/bin/env node
import path from "node:path";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { env, run } from "./lib.mjs";

const repository = path.resolve(process.argv[2] || env("APT_REPO_ROOT", ""));
const suite = process.argv[3] || env("DEB_SUITE", "stable");
const architecture = process.argv[4] || env("TARGET_ARCH", "amd64");
if (!repository) throw new Error("APT repository root is required");

const pool = path.join(repository, "pool/main/g/glusterfs");
const binary = path.join(
  repository,
  "dists",
  suite,
  "main",
  "binary-" + architecture,
);
await mkdir(pool, { recursive: true });
await mkdir(binary, { recursive: true });
for (const file of await readdir(repository)) {
  if (!file.endsWith(".deb")) continue;
  await copyFile(path.join(repository, file), path.join(pool, file));
  await rm(path.join(repository, file));
}

const packages = (
  await run("dpkg-scanpackages", ["pool", "/dev/null"], {
    cwd: repository,
    capture: true,
  })
).stdout;
const packagesFile = path.join(binary, "Packages");
await writeFile(packagesFile, packages);
await run("sh", [
  "-c",
  'gzip -9 -c -- "$1" > "$2"',
  "gzip",
  packagesFile,
  path.join(binary, "Packages.gz"),
]);
await run("sh", [
  "-c",
  'xz -9 -c -- "$1" > "$2"',
  "xz",
  packagesFile,
  path.join(binary, "Packages.xz"),
]);

const release = (
  await run(
    "apt-ftparchive",
    [
      "-o",
      "APT::FTPArchive::Release::Suite=" + suite,
      "-o",
      "APT::FTPArchive::Release::Codename=" + suite,
      "-o",
      "APT::FTPArchive::Release::Architectures=" + architecture,
      "-o",
      "APT::FTPArchive::Release::Components=main",
      "release",
      path.join(repository, "dists", suite),
    ],
    {
      cwd: repository,
      capture: true,
    },
  )
).stdout;
const releaseFile = path.join(repository, "dists", suite, "Release");
await writeFile(releaseFile, release);

const key = env("APT_SIGNING_KEY", env("RPM_SIGNING_KEY", ""));
if (key) {
  const passphrase = env(
    "APT_SIGNING_PASSPHRASE_FILE",
    env("RPM_SIGNING_PASSPHRASE_FILE", ""),
  );
  const extra = passphrase
    ? ["--pinentry-mode", "loopback", "--passphrase-file", passphrase]
    : [];
  await run("gpg", [
    "--batch",
    "--yes",
    ...extra,
    "--clearsign",
    "--local-user",
    key,
    "--output",
    path.join(repository, "dists", suite, "InRelease"),
    releaseFile,
  ]);
  await run("gpg", [
    "--batch",
    "--yes",
    ...extra,
    "--armor",
    "--detach-sign",
    "--local-user",
    key,
    "--output",
    path.join(repository, "dists", suite, "Release.gpg"),
    releaseFile,
  ]);
}
console.log("APT repository generated: " + repository);
