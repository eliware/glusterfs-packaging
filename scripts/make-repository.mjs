#!/usr/bin/env node
import path from "node:path";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { repoRoot, exists, remove, run, runInteractive } from "./lib.mjs";
const versionDir =
  process.argv[2] || path.join(repoRoot, "artifacts/el10/x86_64/stable");
const stableDir =
  process.argv[3] || path.join(repoRoot, "artifacts/el10/x86_64/stable");
if (!(await exists(versionDir)))
  throw new Error(`package directory does not exist: ${versionDir}`);
await runInteractive("createrepo_c", ["--update", versionDir]);
await remove(stableDir);
await mkdir(stableDir, { recursive: true });
for (const file of await readdir(versionDir))
  await copyFile(path.join(versionDir, file), path.join(stableDir, file)).catch(
    () => {},
  );
await runInteractive("createrepo_c", ["--update", stableDir]);
for (const directory of [versionDir, stableDir]) {
  const rpmFiles = (await readdir(directory))
    .filter((file) => file.endsWith(".rpm"))
    .sort();
  if (!rpmFiles.length)
    throw new Error(`no RPM files found in ${directory}`);
  const { stdout } = await run("sha256sum", ["--", ...rpmFiles], {
    cwd: directory,
    capture: true,
  });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path.join(directory, "SHA256SUMS"), stdout),
  );
}
console.log(`Repository metadata generated for ${versionDir}`);
