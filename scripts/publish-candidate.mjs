#!/usr/bin/env node
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { acquirePublicationLock } from "./publication-lock.mjs";
import {
  atomicWrite,
  env,
  exists,
  repoRoot,
  run,
  runInteractive,
} from "./lib.mjs";
import { withMetadataVersion } from "./metadata-version.mjs";

const mode = process.argv[2] || "stable";
const candidate = process.argv[3];
const rpmDirArgument = process.argv[4];
const version = env("RELEASE_VERSION", "stable");
const publishRoot = env(
  "PUBLISH_ROOT",
  "/mnt/pvc/gluster-repository-http",
);
const image = env("IMAGE_REFERENCE", "unknown");
const digest = env("IMAGE_DIGEST", "unknown");
const rpmOnly = env("RPM_ONLY", "0") === "1";
const packageOnly = env("PACKAGE_ONLY", "0") === "1";
const packageFormat = env("PACKAGE_FORMAT", "");
const rpmDir = rpmDirArgument && rpmDirArgument !== "-" ? rpmDirArgument : "";
const debRoot = env("DEB_ROOT", "");
const provenanceRoot = env("PROVENANCE_ROOT", "");
const provenanceUrl = env("PROVENANCE_URL", "");
if (!candidate || (!rpmDir && !debRoot))
  throw new Error(
    "usage: publish-candidate.mjs MODE CANDIDATE RPM_DIR|- with DEB_ROOT for DEB-only publication",
  );
if (!(await exists(publishRoot)))
  throw new Error(`publication root does not exist: ${publishRoot}`);
const filesystem = (
  await run("findmnt", ["-T", publishRoot, "-n", "-o", "FSTYPE"], {
    capture: true,
  })
).stdout.trim();
if (filesystem !== "fuse.glusterfs")
  throw new Error(
    `publication root is not on a Gluster filesystem: ${publishRoot} (${filesystem || "unknown"})`,
  );

const releaseTarget = (relativePath) => path.join(publishRoot, relativePath);
const generation = `${new Date().toISOString().replace(/[-:.]/g, "")}-${process.pid}-${randomUUID().slice(0, 8)}`;
const generationRoot = path.join(publishRoot, ".generations", generation);
const generationRecord = path.join(generationRoot, "generation.json");

async function switchTarget(target, source) {
  const next = `${target}.next`;
  await mkdir(path.dirname(target), { recursive: true });
  await rm(next, { recursive: true, force: true });
  await symlink(path.relative(path.dirname(target), source), next, "dir");
  try {
    const current = await lstat(target);
    if (current.isSymbolicLink()) {
      await rename(next, target);
      return;
    }
    const previousTarget = `${target}.previous-${generation}`;
    await rename(target, previousTarget);
    await rename(next, target);
    await rm(previousTarget, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await rename(next, target);
  }
}

async function copyRelease(source, relativeTarget) {
  const sourceTarget = path.join(generationRoot, relativeTarget);
  await rm(sourceTarget, { recursive: true, force: true });
  await mkdir(path.dirname(sourceTarget), { recursive: true });
  await cp(source, sourceTarget, { recursive: true });
  return sourceTarget;
}

async function copyOptional(source, destination) {
  if (source && (await exists(source))) {
    await mkdir(path.dirname(destination), { recursive: true });
    const sourceType = await lstat(source);
    await cp(source, destination, { recursive: sourceType.isDirectory() });
  }
}

async function copyProvenance(target) {
  if (!provenanceRoot) return;
  for (const name of [
    "provenance.json",
    "provenance.json.asc",
    "checksums.sha256",
  ])
    await copyOptional(
      path.join(provenanceRoot, name),
      path.join(target, name),
    );
  await copyOptional(
    path.join(provenanceRoot, "assets"),
    path.join(target, "assets"),
  );
}

async function removeMisplacedDebPreview() {
  if (mode !== "preview" || packageFormat !== "deb") return;
  const misplaced = releaseTarget(path.join("el10/x86_64/previews", candidate));
  try {
    const contents = await readdir(misplaced);
    const allowed = new Set(["metadata.json"]);
    if (contents.length && contents.every((name) => allowed.has(name)))
      await rm(misplaced, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function writeGenerationRecord() {
  await mkdir(generationRoot, { recursive: true });
  await writeFile(
    generationRecord,
    `${JSON.stringify(
      withMetadataVersion({
        schema: 1,
        generation,
        mode,
        candidate,
        version,
        created: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      }),
      null,
      2,
    )}\n`,
  );
}

async function removeExpiredPreviewGenerations() {
  if (mode !== "preview") return;
  const previewRoot = releaseTarget("el10/x86_64/previews");
  await mkdir(previewRoot, { recursive: true });
  const names = (await readdir(previewRoot)).sort().reverse();
  const retained = new Set(names.slice(0, 30));
  for (const name of names.slice(30)) {
    await rm(path.join(previewRoot, name), { recursive: true, force: true });
    for (const generationName of await readdir(
      path.join(publishRoot, ".generations"),
    )) {
      const recordPath = path.join(
        publishRoot,
        ".generations",
        generationName,
        "generation.json",
      );
      try {
        const record = JSON.parse(await readFile(recordPath, "utf8"));
        if (
          record.mode === "preview" &&
          record.candidate === name &&
          !retained.has(name)
        )
          await rm(path.join(publishRoot, ".generations", generationName), {
            recursive: true,
            force: true,
          });
      } catch {
        /* Ignore incomplete or already-removed generations. */
      }
    }
  }
}

const releaseLock = await acquirePublicationLock(publishRoot);
try {
  await mkdir(path.join(publishRoot, "keys"), { recursive: true });
  await mkdir(path.join(publishRoot, "metadata"), { recursive: true });
  await mkdir(generationRoot, { recursive: true });

  let rpmTarget = null;
  let validationFile = env("VALIDATION_FILE", "");
  const containerValidationFile = env("CONTAINER_VALIDATION_FILE", "");
  if (rpmDir) {
    const targetRelative =
      mode === "preview"
        ? path.join("el10/x86_64/previews", candidate)
        : path.join("el10/x86_64", version);
    rpmTarget = await copyRelease(rpmDir, targetRelative);
    if (!validationFile) validationFile = path.join(rpmDir, "validation.json");
    await copyOptional(validationFile, path.join(rpmTarget, "validation.json"));
    await copyOptional(
      containerValidationFile,
      path.join(rpmTarget, "container-validation.json"),
    );
    await copyProvenance(rpmTarget);
    await switchTarget(releaseTarget(targetRelative), rpmTarget);
    if (mode === "stable")
      await switchTarget(releaseTarget("el10/x86_64/stable"), rpmTarget);
  }
  if (debRoot && (await exists(debRoot))) {
    for (const distribution of await readdir(debRoot)) {
      const distributionRoot = path.join(debRoot, distribution);
      if (!(await exists(distributionRoot))) continue;
      for (const suite of await readdir(distributionRoot)) {
        const suiteRoot = path.join(distributionRoot, suite);
        for (const architecture of await readdir(suiteRoot)) {
          const source = path.join(suiteRoot, architecture, version);
          if (!(await exists(source))) continue;
          const relative = path.join(
            distribution,
            suite,
            architecture,
            mode === "preview" ? "previews" : "",
            mode === "preview" ? candidate : version,
          );
          const debTarget = await copyRelease(source, relative);
          await copyOptional(
            validationFile,
            path.join(debTarget, "validation.json"),
          );
          await copyProvenance(debTarget);
          await switchTarget(releaseTarget(relative), debTarget);
          if (mode === "stable")
            await switchTarget(
              releaseTarget(
                path.join(distribution, suite, architecture, "stable"),
              ),
              debTarget,
            );
        }
      }
    }
  }

  if (mode === "preview") await removeExpiredPreviewGenerations();
  await removeMisplacedDebPreview();
  if (!rpmOnly && !packageOnly) {
    const catalogNext = path.join(publishRoot, "metadata/catalog.json.next");
    await runInteractive("node", [
      path.join(repoRoot, "scripts/write-catalog.mjs"),
      "--output",
      catalogNext,
      "--publish-root",
      publishRoot,
      "--channel",
      mode,
      "--version",
      version,
      "--built",
      new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      "--image",
      image,
      "--digest",
      digest,
      "--candidate",
      candidate,
      "--package-candidate",
      env("PACKAGE_CANDIDATE", candidate),
      "--generation",
      generation,
      "--image-aliases",
      env("IMAGE_ALIASES", ""),
      "--base-image-digest",
      env("BASE_IMAGE_DIGEST", ""),
      "--base-image",
      env("BASE_IMAGE", ""),
      "--source-ref",
      env("SOURCE_REF", mode === "preview" ? "devel" : `v${version}`),
      "--source-commit",
      env("SOURCE_COMMIT", "unknown"),
      "--validation-file",
      validationFile,
      "--container-validation-file",
      containerValidationFile,
      "--distribution",
      env("IMAGE_DISTRIBUTION", "centos-stream"),
      ...(provenanceUrl ? ["--provenance", provenanceUrl] : []),
    ]);
    await rename(catalogNext, path.join(publishRoot, "metadata/catalog.json"));
    const repoFile = path.join(publishRoot, "glusterfs-el10.repo");
    await cp(
      path.join(repoRoot, "templates/glusterfs-el10.repo"),
      `${repoFile}.next`,
    );
    await rename(`${repoFile}.next`, repoFile);
    await runInteractive("node", [
      path.join(repoRoot, "scripts/generate-repository-index.mjs"),
      "--root",
      publishRoot,
    ]);
    await runInteractive("node", [
      path.join(repoRoot, "scripts/write-release-manifest.mjs"),
      "--root",
      publishRoot,
      "--generation",
      generation,
    ]);
  }

  if (packageOnly) {
    const repoFile = path.join(publishRoot, "glusterfs-el10.repo");
    await cp(
      path.join(repoRoot, "templates/glusterfs-el10.repo"),
      `${repoFile}.next`,
    );
    await rename(`${repoFile}.next`, repoFile);
    await runInteractive("node", [
      path.join(repoRoot, "scripts/write-catalog.mjs"),
      "--output",
      path.join(publishRoot, "metadata/catalog.json.next"),
      "--publish-root",
      publishRoot,
      "--package-only",
      "1",
      "--package-format",
      packageFormat,
      "--package-version",
      env("PACKAGE_VERSION", version),
      "--channel",
      mode === "preview" ? "preview" : "stable",
      "--version",
      version,
      "--candidate",
      candidate,
      "--distribution",
      env("PACKAGE_DISTRIBUTION", "unknown"),
      "--suite",
      env("PACKAGE_SUITE", ""),
      "--built",
      new Date().toISOString(),
      "--source-ref",
      env("SOURCE_REF", "unknown"),
      "--source-commit",
      env("SOURCE_COMMIT", "unknown"),
      "--validation-file",
      env("VALIDATION_FILE", ""),
      ...(provenanceUrl ? ["--provenance", provenanceUrl] : []),
    ]);
    await rename(
      path.join(publishRoot, "metadata/catalog.json.next"),
      path.join(publishRoot, "metadata/catalog.json"),
    );
    await runInteractive("node", [
      path.join(repoRoot, "scripts/generate-repository-index.mjs"),
      "--root",
      publishRoot,
    ]);
    await runInteractive("node", [
      path.join(repoRoot, "scripts/write-release-manifest.mjs"),
      "--root",
      publishRoot,
      "--generation",
      generation,
    ]);
  }

  await copyOptional(
    path.join(repoRoot, "artifacts/keys/RPM-GPG-KEY-ELIWARE-GLUSTER"),
    path.join(publishRoot, "keys/RPM-GPG-KEY-ELIWARE-GLUSTER"),
  );
  await writeGenerationRecord();
  await atomicWrite(
    path.join(publishRoot, "metadata/active-generation.json"),
    `${JSON.stringify(withMetadataVersion({ schema: 1, generation, updated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }), null, 2)}\n`,
  );
  console.log(
    `${rpmOnly ? "Published RPM candidate" : "Published candidate"} ${candidate} as generation ${generation}`,
  );
} finally {
  await releaseLock();
}
