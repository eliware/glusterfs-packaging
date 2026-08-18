#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  env,
  exists,
  parseEnvFile,
  repoRoot,
  run,
  runInteractive,
} from "./lib.mjs";

const configFile = env(
  "BUILD_CONFIG",
  path.join(repoRoot, "build-config/debian-bookworm-amd64.env"),
);
const config = { ...(await parseEnvFile(configFile)), ...process.env };
const target = config.TARGET_OS;
const suite = config.DEB_SUITE;
const workspace = env("WORKSPACE_ROOT", "/workspaces/" + target + "-" + suite);
const sourceDir = env("SOURCE_DIR", path.join(workspace, "source"));
const outputDir = env(
  "OUTPUT_DIR",
  path.join(
    repoRoot,
    "artifacts",
    target,
    suite,
    config.TARGET_ARCH,
    config.GLUSTER_VERSION || "11.2",
  ),
);
const sourceRef = env("SOURCE_REF", config.GLUSTER_TAG || "v11.2");
const jobs = env(
  "JOBS",
  String((await run("nproc", [], { capture: true })).stdout.trim()),
);

if (!target || !suite) throw new Error("TARGET_OS and DEB_SUITE are required");
for (const tool of ["git", "dpkg-buildpackage", "mk-build-deps", "sha256sum"])
  await run("which", [tool]);

// The workflow passes a workspace path below its per-run RAM directory. Make
// the workspace itself first so the packaging archive download has a valid
// destination even on a fresh runner.
await mkdir(workspace, { recursive: true });
await mkdir(sourceDir, { recursive: true });
await mkdir(outputDir, { recursive: true });
if (!(await exists(path.join(sourceDir, ".git")))) {
  await runInteractive("git", [
    "clone",
    "--branch",
    sourceRef,
    "--depth",
    "1",
    config.UPSTREAM_REPOSITORY || "https://github.com/gluster/glusterfs.git",
    sourceDir,
  ]);
} else if (env("SOURCE_REF")) {
  await runInteractive("git", [
    "-C",
    sourceDir,
    "fetch",
    "--depth",
    "1",
    "origin",
    sourceRef,
  ]);
  await runInteractive("git", [
    "-C",
    sourceDir,
    "reset",
    "--hard",
    "FETCH_HEAD",
  ]);
  await runInteractive("git", ["-C", sourceDir, "clean", "-fdx"]);
}

const patchFile = path.join(
  repoRoot,
  "patches/python312-version-detection.patch",
);
if (env("APPLY_PATCHES", "1") === "1" && (await exists(patchFile))) {
  try {
    await run("git", ["-C", sourceDir, "apply", "--check", patchFile]);
    await runInteractive("git", ["-C", sourceDir, "apply", patchFile]);
  } catch {
    await run("git", [
      "-C",
      sourceDir,
      "apply",
      "--reverse",
      "--check",
      patchFile,
    ]);
  }
}

const archive = path.join(workspace, "debian-packaging.tar.xz");
if (!(await exists(archive)))
  await runInteractive("curl", [
    "--fail",
    "--location",
    "--retry",
    "5",
    "--output",
    archive,
    config.DEB_PACKAGING_URL,
  ]);
const digest = crypto
  .createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
if (digest !== config.DEB_PACKAGING_SHA256)
  throw new Error("DEB packaging archive checksum mismatch: " + digest);

await rm(path.join(sourceDir, "debian"), { recursive: true, force: true });
await runInteractive("tar", ["-xJf", archive, "-C", sourceDir]);

// The Debian packaging archive carries patches written for released source
// snapshots. Rolling builds can move the surrounding source far enough that
// the hashbang cleanup patch no longer applies even though its intended
// result is already present or can be applied directly. Keep the workaround
// narrow: only bypass that one patch when its historical context is absent.
const patchSeries = path.join(sourceDir, "debian/patches/series");
const completionFile = path.join(
  sourceDir,
  "extras/command-completion/gluster.bash",
);
if ((await exists(patchSeries)) && (await exists(completionFile))) {
  const patchName = "05-remove-hashbang.diff";
  const series = await readFile(patchSeries, "utf8");
  const completion = await readFile(completionFile, "utf8");
  const hasHistoricalContext = completion.includes("if pidof glusterd");
  if (
    series.split("\n").some((line) => line.trim() === patchName) &&
    !hasHistoricalContext
  ) {
    const cleaned = completion.replace(/^#!\/bin\/bash\n\n/, "");
    if (cleaned !== completion) await writeFile(completionFile, cleaned);
    await writeFile(
      patchSeries,
      series
        .split("\n")
        .filter((line) => line.trim() !== patchName)
        .join("\n"),
    );
    console.log(
      "Adjusted Debian hashbang patch for rolling source layout: " + patchName,
    );
  }
}
const shellPatch = "08-bash-term-in-posix-shell.diff";
const shellFiles = [
  "tools/gfind_missing_files/gfid_to_path.sh",
  "tools/gfind_missing_files/gfind_missing_files.sh",
].map((file) => path.join(sourceDir, file));
if ((await exists(patchSeries)) && shellFiles.every((file) => exists(file))) {
  const series = await readFile(patchSeries, "utf8");
  const shellTexts = await Promise.all(
    shellFiles.map((file) => readFile(file, "utf8")),
  );
  const hasMixedRollingState =
    shellTexts.some((text) => text.startsWith("#!/bin/bash")) &&
    shellTexts.some((text) => text.startsWith("#!/bin/sh"));
  if (
    series.split("\n").some((line) => line.trim() === shellPatch) &&
    hasMixedRollingState
  ) {
    await Promise.all(
      shellFiles.map(async (file, index) => {
        const text = shellTexts[index];
        if (text.startsWith("#!/bin/sh"))
          await writeFile(file, text.replace(/^#!\/bin\/sh/, "#!/bin/bash"));
      }),
    );
    await writeFile(
      patchSeries,
      series
        .split("\n")
        .filter((line) => line.trim() !== shellPatch)
        .join("\n"),
    );
    console.log(
      "Adjusted Debian shell patch for rolling source layout: " + shellPatch,
    );
  }
}
if (target === "ubuntu") {
  const control = path.join(sourceDir, "debian/control");
  const controlText = await readFile(control, "utf8");
  await writeFile(control, controlText.replaceAll("libaio1", "libaio1t64"));

  // Ubuntu 24.04 renamed the runtime package during the time64 transition.
  // dpkg-shlibdeps derives ${shlibs:Depends} from the ELF soname after
  // debian/control has been processed, so changing control alone is not
  // sufficient. Override the soname mapping for this Ubuntu build only.
  const shlibsLocal = path.join(sourceDir, "debian/shlibs.local");
  const shlibsText = (await exists(shlibsLocal))
    ? await readFile(shlibsLocal, "utf8")
    : "";
  const shlibsOverride = "libaio 1 libaio1t64 (>= 0.3.93)";
  if (!shlibsText.split("\n").some((line) => line.trim() === shlibsOverride))
    await writeFile(
      shlibsLocal,
      `${shlibsText}${shlibsText.endsWith("\n") || !shlibsText ? "" : "\n"}${shlibsOverride}\n`,
    );
}
const changelog = path.join(sourceDir, "debian/changelog");
const changelogText = await readFile(changelog, "utf8");
const packageVersion = env("DEB_PACKAGE_VERSION", config.DEB_PACKAGE_VERSION);
await writeFile(
  changelog,
  changelogText.replace(
    /^glusterfs \([^)]*\)/m,
    "glusterfs (" + packageVersion + ")",
  ),
);

await runInteractive("apt-get", ["update"]);
await runInteractive(
  "mk-build-deps",
  ["--install", "--tool=apt-get -y --no-install-recommends", "debian/control"],
  { cwd: sourceDir },
);
await runInteractive("dpkg-buildpackage", ["-us", "-uc", "-b", "-j" + jobs], {
  cwd: sourceDir,
  env: {
    ...process.env,
    CCACHE_BASEDIR: sourceDir,
    CCACHE_COMPILERCHECK: "content",
    CCACHE_NOHASHDIR: "1",
    DEB_BUILD_OPTIONS: "parallel=" + jobs,
    PATH: `/usr/lib/ccache:${process.env.PATH || ""}`,
  },
});

const parent = path.dirname(sourceDir);
for (const file of await readdir(parent))
  if (file.endsWith(".deb"))
    await copyFile(path.join(parent, file), path.join(outputDir, file));
const packages = (await readdir(outputDir)).filter((file) =>
  file.endsWith(".deb"),
);
if (!packages.length) throw new Error("no DEBs were produced in " + outputDir);
console.log(
  "Built " +
    packages.length +
    " " +
    target +
    "/" +
    suite +
    " DEB packages into " +
    outputDir,
);
