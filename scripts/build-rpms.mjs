#!/usr/bin/env node
import path from "node:path";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  repoRoot,
  env,
  exists,
  parseEnvFile,
  run,
  runInteractive,
  commandExists,
} from "./lib.mjs";
import { pythonPatchAction } from "./python-patch.mjs";

const configFile = env(
  "BUILD_CONFIG",
  path.join(repoRoot, "build-config/el10-x86_64.env"),
);
if (!(await exists(configFile)))
  throw new Error(`build config does not exist: ${configFile}`);
const config = { ...(await parseEnvFile(configFile)), ...process.env };
const sourceDir = env("SOURCE_DIR", path.join(repoRoot, "source"));
const outputDir = env(
  "OUTPUT_DIR",
  path.join(repoRoot, "artifacts/el10/x86_64/stable"),
);
const selinuxDir = env(
  "SELINUX_SOURCE_DIR",
  path.join(repoRoot, "selinux-source"),
);
const sourceRef = env("SOURCE_REF", config.GLUSTER_TAG);
await mkdir(sourceDir, { recursive: true });
await mkdir(outputDir, { recursive: true });
const sourceMainDir = env("SOURCE_MAIN_DIR");
if (sourceMainDir) {
  if (!(await exists(path.join(sourceMainDir, ".git"))))
    await runInteractive("git", [
      "clone",
      config.UPSTREAM_REPOSITORY,
      sourceMainDir,
    ]);
  await runInteractive("git", [
    "-C",
    sourceMainDir,
    "fetch",
    "--prune",
    "origin",
    sourceRef,
  ]);
  if (!(await exists(path.join(sourceDir, ".git"))))
    await runInteractive("git", [
      "-C",
      sourceMainDir,
      "worktree",
      "add",
      "--detach",
      sourceDir,
      "FETCH_HEAD",
    ]);
  else {
    const currentRevision = (
      await run("git", ["-C", sourceDir, "rev-parse", "HEAD"], {
        capture: true,
      })
    ).stdout.trim();
    const targetRevision = (
      await run("git", ["-C", sourceMainDir, "rev-parse", "FETCH_HEAD"], {
        capture: true,
      })
    ).stdout.trim();
    if (currentRevision !== targetRevision) {
      await runInteractive("git", [
        "-C",
        sourceDir,
        "reset",
        "--hard",
        "FETCH_HEAD",
      ]);
      await runInteractive("git", ["-C", sourceDir, "clean", "-fdx"]);
    }
  }
} else if (!(await exists(path.join(sourceDir, ".git"))))
  await runInteractive("git", [
    "clone",
    "--branch",
    sourceRef,
    "--depth",
    "1",
    config.UPSTREAM_REPOSITORY,
    sourceDir,
  ]);
else if (env("SOURCE_REF")) {
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
}
const patchFile = path.join(
  repoRoot,
  "patches",
  "python312-version-detection.patch",
);
const pythonMacroFile = path.join(sourceDir, "contrib/aclocal/python.m4");
if (env("APPLY_PATCHES", "1") === "1" && (await exists(patchFile))) {
  try {
    const sourceText = (await exists(pythonMacroFile))
      ? await readFile(pythonMacroFile, "utf8")
      : null;
    const action = pythonPatchAction(sourceText);
    if (action === "apply") {
      await run("git", ["-C", sourceDir, "apply", "--check", patchFile]);
      await runInteractive("git", ["-C", sourceDir, "apply", patchFile]);
    } else if (action === "error") {
      throw new Error(`patch target has unexpected contents: ${pythonMacroFile}`);
    }
  }
  catch (error) {
    if (error.message.startsWith("patch target has unexpected contents:")) throw error;
    throw new Error(`patch does not apply cleanly: ${patchFile}`, { cause: error });
  }
}
const versionFile = path.join(sourceDir, "VERSION");
const packageVersionOverride = env("PACKAGE_VERSION_OVERRIDE");
if (packageVersionOverride) {
  const stable = /^(\d+\.\d+(?:\.\d+)?)$/.exec(packageVersionOverride);
  const rolling = /^(\d{4}\.\d{2}\.\d{2})-0\.git([0-9a-f]+)$/i.exec(
    packageVersionOverride,
  );
  if (stable) await writeFile(versionFile, `v${stable[1]}-0\n`);
  else if (rolling)
    await writeFile(versionFile, `v${rolling[1]}-0-g${rolling[2]}\n`);
  else
    throw new Error(
      `unsupported RPM package version override: ${packageVersionOverride}`,
    );
} else await rm(versionFile, { force: true });
const configureOptions = (config.CONFIGURE_OPTIONS || "")
  .split(/\s+/)
  .filter(Boolean);
const ccacheDir = env(
  "CCACHE_DIR",
  path.join(path.dirname(sourceDir), "ccache"),
);
const buildEnv = {
  ...process.env,
  CCACHE_DIR: ccacheDir,
  CCACHE_BASEDIR: sourceDir,
  CCACHE_COMPILERCHECK: "content",
  CCACHE_NOHASHDIR: "1",
  PATH: `/usr/lib64/ccache:${process.env.PATH || ""}`,
};
await mkdir(ccacheDir, { recursive: true });
const configureStamp = path.join(
  path.dirname(sourceDir),
  "configure-inputs.json",
);
async function assertConfiguredPackageIdentity() {
  if (!packageVersionOverride) return;
  const makefile = await readFile(path.join(sourceDir, "Makefile"), "utf8");
  const version = makefile.match(/^PACKAGE_VERSION = (.+)$/m)?.[1]?.trim();
  const release = makefile.match(/^PACKAGE_RELEASE = (.+)$/m)?.[1]?.trim();
  const expected = packageVersionOverride.match(
    /^(\d+\.\d+(?:\.\d+)?|\d{4}\.\d{2}\.\d{2})-?(?:0\.git([0-9a-f]+))?$/i,
  );
  const expectedVersion = expected?.[1] || packageVersionOverride;
  const expectedRelease = expected?.[2] ? `0.git${expected[2]}` : "0";
  if (version !== expectedVersion || release !== expectedRelease)
    throw new Error(
      `configured RPM identity ${version}-${release} does not match expected ${expectedVersion}-${expectedRelease}`,
    );
}
const configureInputs = JSON.stringify({
  sourceRevision: (
    await run("git", ["-C", sourceDir, "rev-parse", "HEAD"], { capture: true })
  ).stdout.trim(),
  configureOptions,
  packageVersion: env("PACKAGE_VERSION_OVERRIDE", ""),
  applyPatches: env("APPLY_PATCHES", "1"),
});
let cachedConfiguration = "";
try {
  cachedConfiguration = await readFile(configureStamp, "utf8");
} catch {}
if (
  cachedConfiguration === `${configureInputs}\n` &&
  (await exists(path.join(sourceDir, "Makefile")))
)
  console.log(`Reusing configured workspace: ${sourceDir}`);
else {
  const generatedInputsPresent =
    (await exists(path.join(sourceDir, "configure"))) &&
    (await exists(path.join(sourceDir, "Makefile.in")));
  if (generatedInputsPresent)
    console.log("Using upstream generated configure; skipping autogen.sh");
  else {
    for (const tool of ["autoconf", "automake", "libtoolize"])
      if (!(await commandExists(tool)))
        throw new Error(`missing Autotools component: ${tool}`);
    const preservedConfigure = path.join(sourceDir, ".configure.upstream");
    const preserveUpstreamConfigure = await exists(
      path.join(sourceDir, "configure"),
    );
    if (preserveUpstreamConfigure)
      await copyFile(path.join(sourceDir, "configure"), preservedConfigure);
    try {
      await runInteractive("./autogen.sh", [], {
        cwd: sourceDir,
        env: buildEnv,
      });
    } finally {
      if (preserveUpstreamConfigure) {
        await copyFile(preservedConfigure, path.join(sourceDir, "configure"));
        await rm(preservedConfigure, { force: true });
      }
    }
  }
  const configureFile = path.join(sourceDir, "configure");
  const configureLines = (await readFile(configureFile, "utf8")).split("\n");
  const symbolLine = configureLines.findIndex(
    (line) => line === 'lt_cv_sys_global_symbol_to_cdecl="$SED -n"\\',
  );
  if (
    symbolLine >= 0 &&
    configureLines[symbolLine + 1]?.startsWith("$lt_cdecl_hook")
  ) {
    // EL10's RPM %configure LTO rewrite replaces this assignment but leaves
    // multiline continuations behind. Collapse it before the macro runs.
    configureLines.splice(
      symbolLine,
      5,
      "lt_cv_sys_global_symbol_to_cdecl=\"$SED -n -e 's/^T .* \\(.*\\)$/extern int \\1();/p' -e 's/^$symcode$symcode* .* \\(.*\\)$/extern char \\1;/p'\"",
    );
    await writeFile(configureFile, configureLines.join("\n"));
  }
  await runInteractive("./configure", configureOptions, {
    cwd: sourceDir,
    env: buildEnv,
  });
  await assertConfiguredPackageIdentity();
  await writeFile(configureStamp, `${configureInputs}\n`);
}
await assertConfiguredPackageIdentity();
if (env("BUILD_ONLY", "0") === "1") {
  await runInteractive(
    "make",
    [
      "-j",
      env(
        "JOBS",
        String((await run("nproc", [], { capture: true })).stdout.trim()),
      ),
    ],
    { cwd: sourceDir, env: buildEnv },
  );
  console.log(`Incremental compile check passed for ${sourceDir}`);
  process.exit(0);
}
await runInteractive(
  "make",
  ["-C", "extras/LinuxRPM", "glusterrpms_without_autogen"],
  { cwd: sourceDir, env: buildEnv },
);
for (const file of await readdir(path.join(sourceDir, "extras/LinuxRPM")))
  if (file.endsWith(".rpm"))
    await copyFile(
      path.join(sourceDir, "extras/LinuxRPM", file),
      path.join(outputDir, file),
    );
if (!(await exists(path.join(selinuxDir, "glusterfs-selinux.spec"))))
  await runInteractive("git", [
    "clone",
    "--branch",
    config.SELINUX_TAG,
    "--depth",
    "1",
    config.SELINUX_REPOSITORY,
    selinuxDir,
  ]);
for (const target of ["prep", "rpms", "srcrpm"])
  await runInteractive("make", [target], { cwd: selinuxDir });
for (const file of await readdir(selinuxDir))
  if (file.endsWith(".rpm"))
    await copyFile(path.join(selinuxDir, file), path.join(outputDir, file));
console.log(`Built packages into ${outputDir}`);
