#!/usr/bin/env node
import path from "node:path";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { env, repoRoot, run, runInteractive } from "./lib.mjs";
const versionDir =
  process.argv[2] || path.join(repoRoot, "artifacts/el10/x86_64/stable");
const stableDir =
  process.argv[3] || path.join(repoRoot, "artifacts/el10/x86_64/stable");
const key = env("RPM_SIGNING_KEY");
if (!key)
  throw new Error("set RPM_SIGNING_KEY to the signing key name or fingerprint");
const passphrase = env("RPM_SIGNING_PASSPHRASE_FILE");
const signingEnv = { ...process.env };
delete signingEnv.GPG_TTY;
const rpmFiles = (await readdir(versionDir)).filter((name) =>
  name.endsWith(".rpm"),
);
if (!rpmFiles.some((name) => /^glusterfs-selinux-.*\.noarch\.rpm$/.test(name)))
  throw new Error(`missing installable glusterfs-selinux RPM in ${versionDir}`);

for (const file of rpmFiles) {
  const args = ["--addsign", "--key-id", key];
  args.unshift(
    "--define",
    `_gpg_sign_cmd_extra_args --batch --pinentry-mode loopback${passphrase ? ` --passphrase-file ${passphrase}` : ""}`,
  );
  await runInteractive("rpmsign", args.concat(path.join(versionDir, file)), {
    env: signingEnv,
    suppress: [
      /^warning: Could not set GPG_TTY to stdin: Inappropriate ioctl for device$/i,
    ],
  });
}
for (const file of rpmFiles) {
  const result = await run("rpm", ["--checksig", "--verbose", file], {
    cwd: versionDir,
    capture: true,
  });
  const verification = `${result.stdout}\n${result.stderr}`;
  if (!/Signature.*:\s+OK/.test(verification))
    throw new Error(`RPM signature missing or invalid: ${file}`);
}
for (const directory of [versionDir]) {
  await runInteractive("createrepo_c", ["--update", directory]);
  const rpms = (await readdir(directory))
    .filter((name) => name.endsWith(".rpm"))
    .sort();
  const sums = (
    await run("sha256sum", ["--", ...rpms], { cwd: directory, capture: true })
  ).stdout;
  await writeFile(path.join(directory, "SHA256SUMS"), sums);
  for (const file of ["repodata/repomd.xml", "SHA256SUMS"])
    await runInteractive(
      "gpg",
      [
        "--batch",
        "--yes",
        "--pinentry-mode",
        "loopback",
        ...(passphrase ? ["--passphrase-file", passphrase] : []),
        "--armor",
        "--detach-sign",
        "--local-user",
        key,
        path.join(directory, file),
      ],
      { env: signingEnv },
    );
}
await rm(stableDir, { recursive: true, force: true });
await mkdir(stableDir, { recursive: true });
await cp(versionDir, stableDir, { recursive: true });
await mkdir(path.join(repoRoot, "artifacts/keys"), { recursive: true });
const exported = (
  await run("gpg", ["--armor", "--export", key], {
    capture: true,
    env: signingEnv,
  })
).stdout;
await writeFile(
  path.join(repoRoot, "artifacts/keys/RPM-GPG-KEY-ELIWARE-GLUSTER"),
  exported,
);
console.log(`Signed repositories with ${key}`);
