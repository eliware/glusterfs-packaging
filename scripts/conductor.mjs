#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  rename,
  readdir,
} from "node:fs/promises";
import {
  atomicWrite,
  env,
  exists,
  repoRoot,
  run,
  runInteractive,
  tempDir,
} from "./lib.mjs";
import {
  METADATA_VERSION,
  assertMetadataVersion,
} from "./metadata-version.mjs";
import { readMetadata } from "./metadata-io.mjs";
import {
  assertValidationRecord,
  markPublicationVerified,
} from "./validation-schema.mjs";
import { notifyConductor } from "./discord-notifier.mjs";
import { generateReleaseReport } from "./release-report.mjs";
import {
  checkDockerHubRateLimit,
  DockerHubRateLimitError,
  isDockerHubReference,
} from "./docker-hub-quota.mjs";
import { checkGitHubRateLimit, GitHubRateLimitError } from "./github-quota.mjs";
import {
  mergePackageValidation,
  packageCandidateForPublication,
  packageCheckpointInputsMatch,
  packageSmoke2Complete,
} from "./package-validation.mjs";
import { runPackageSmoke2 } from "./package-lane.mjs";
import {
  compareStatusReports,
  createStatusDocument,
  filterDisplayedStatusReports,
  formatStatusLine,
} from "./conductor-status.mjs";
import { buildLanes, imageTargetsForLane } from "./lane-config.mjs";
import {
  compactTimestamp,
  dateStamp,
  isoTimestamp,
  parseJson,
  stringifyJson,
} from "./serialization.mjs";
import { CONDUCTOR_HELP, parseConductorCliArgs } from "./conductor-cli.mjs";
import { createConductorConfig } from "./conductor-config.mjs";
import { logPlannedImages } from "./conductor-image-plan.mjs";
import { createLocalStageLock } from "./conductor-stage-lock.mjs";
import { dockerAuthFile } from "./docker-hub-auth.mjs";
import { isImageCheckpointValid } from "./image-checkpoint.mjs";
import { publicationFile } from "./publication-paths.mjs";
import { validatePublishedArtifacts } from "./conductor-final-validation.mjs";

const {
  cliArgs,
  dryRun,
  force,
  helpRequested,
  noRebuild: cliNoRebuild,
  skipPublication: cliSkipPublication,
} = parseConductorCliArgs(process.argv);
if (helpRequested) {
  console.log(CONDUCTOR_HELP);
  process.exit(0);
}
const {
  backupScript,
  lockDir,
  noRebuild,
  skipPublication,
  stateFile,
  stateRoot,
  workspaceRoot,
} = createConductorConfig({ cliArgs, cliNoRebuild, cliSkipPublication });
let statusDirectory = "";
let statusReporter;
let completedNoOp = false;
const log = (message, details = "") => {
  const suffix = details ? ` ${details}` : "";
  console.log(`[conductor] ${message}${suffix}`);
};
const notifyFailure = (title, error, fields = []) =>
  notifyConductor({
    title,
    description: error?.message || String(error),
    status: "failure",
    fields,
  });
const upstreamAttempts = Number(env("CONDUCTOR_UPSTREAM_ATTEMPTS", "6"));
const upstreamBackoffMs = Number(env("CONDUCTOR_UPSTREAM_BACKOFF_MS", "3000"));
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const withLocalStageLock = createLocalStageLock({ stateRoot, log });
class NoOpRun extends Error {
  constructor(runId, inputs, results) {
    super("no upstream or build inputs changed");
    this.runId = runId;
    this.inputs = inputs;
    this.results = results;
  }
}
const retryUpstream = async (label, operation) => {
  let lastError;
  for (let attempt = 1; attempt <= upstreamAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === upstreamAttempts) break;
      const delay = Math.min(
        60000,
        upstreamBackoffMs * 2 ** (attempt - 1) +
          Math.round(Math.random() * 1000),
      );
      log(
        "upstream check retry",
        `${label} attempt=${attempt}/${upstreamAttempts} wait=${Math.ceil(delay / 1000)}s`,
      );
      await sleep(delay);
    }
  }
  const error = new Error(
    `${label} could not be verified after ${upstreamAttempts} attempts: ${lastError?.message || lastError}`,
    { cause: lastError },
  );
  await notifyFailure(`${label} failed`, error);
  throw error;
};
await mkdir(stateRoot, { recursive: true });
try {
  await mkdir(lockDir);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  try {
    const owner = parseJson(
      await readFile(path.join(lockDir, "owner.json"), "utf8"),
      "conductor lock owner",
    );
    process.kill(owner.pid, 0);
    throw new Error("another conductor run is already active");
  } catch (ownerError) {
    if (ownerError.message === "another conductor run is already active")
      throw ownerError;
    if (ownerError.code !== "ESRCH" && ownerError.code !== "ENOENT")
      throw ownerError;
    await rm(lockDir, { recursive: true, force: true });
    await mkdir(lockDir);
  }
}
await writeFile(
  path.join(lockDir, "owner.json"),
  stringifyJson({ pid: process.pid, started: isoTimestamp() }),
);
try {
  const runId = `${compactTimestamp()}-${crypto.randomUUID().slice(0, 8)}`;
  statusDirectory = path.join(stateRoot, "status", runId);
  await mkdir(statusDirectory, { recursive: true });
  const reportStatuses = async () => {
    let reports = [];
    try {
      reports = await Promise.all(
        (await readdir(statusDirectory))
          .filter((name) => name.endsWith(".json"))
          .map(async (name) => {
            const report = JSON.parse(
              await readFile(path.join(statusDirectory, name), "utf8"),
            );
            if (report.log_file) {
              try {
                const contents = await readFile(report.log_file, "utf8");
                report.log = `${contents.split(/\r?\n/).filter(Boolean).length}`;
              } catch {}
            }
            return report;
          }),
      );
    } catch {
      return;
    }
    reports = filterDisplayedStatusReports(reports).sort(compareStatusReports);
    if (!reports.length) return;
    log("status report");
    for (const report of reports) {
      log(formatStatusLine(report));
    }
    console.log("====================================");
  };
  const localStatus = (key, label, stage) => {
    const file = path.join(
      statusDirectory,
      `local-${key.replace(/[^a-zA-Z0-9_.-]+/g, "-")}.json`,
    );
    const update = async (status) => {
      await writeFile(
        `${file}.tmp`,
        `${JSON.stringify(
          createStatusDocument({
            label,
            stage,
            runId,
            updated: new Date().toISOString(),
            status,
          }),
          null,
          2,
        )}\n`,
      );
      await rename(`${file}.tmp`, file);
    };
    return { update };
  };
  statusReporter = setInterval(() => {
    reportStatuses().catch((error) =>
      log("status report failed", error.message),
    );
  }, 10000);
  statusReporter.unref();
  log(`run ${runId} started`, dryRun ? "(dry-run)" : "");
  const readJson = async (file, fallback) => {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      return fallback;
    }
  };
  const previous =
    (await readMetadata(stateFile, { allowMissing: true })) ||
    assertMetadataVersion(
      {
        metadata_version: METADATA_VERSION,
        schema: 1,
        checkpoints: {},
        runs: [],
      },
      stateFile,
    );
  const githubQuota = await checkGitHubRateLimit();
  if (githubQuota.checked)
    log(
      "GitHub API quota",
      `${githubQuota.remaining}/${githubQuota.limit} remaining reset=${new Date(githubQuota.reset * 1000).toISOString()}`,
    );
  const releases = JSON.parse(
    (
      await retryUpstream("Gluster release API", () =>
        run(
          "curl",
          [
            "--fail",
            "--silent",
            "--show-error",
            "--retry",
            "0",
            "https://api.github.com/repos/gluster/glusterfs/releases?per_page=100",
          ],
          { capture: true, timeout: 30000 },
        ),
      )
    ).stdout,
  );
  const stableTag = releases
    .filter(
      (item) =>
        !item.draft && !item.prerelease && /^v\d+\.\d+$/.test(item.tag_name),
    )
    .sort((a, b) =>
      String(a.published_at).localeCompare(String(b.published_at)),
    )
    .at(-1)?.tag_name;
  if (!stableTag) throw new Error("no stable GlusterFS release found");
  const tagCommit = (
    await retryUpstream(`Gluster tag ${stableTag}`, () =>
      run(
        "git",
        [
          "ls-remote",
          "https://github.com/gluster/glusterfs.git",
          `refs/tags/${stableTag}^{}`,
        ],
        { capture: true, timeout: 30000 },
      ),
    )
  ).stdout.split(/\s+/)[0];
  const sourceCommit =
    tagCommit ||
    (
      await retryUpstream(`Gluster tag ${stableTag}`, () =>
        run(
          "git",
          [
            "ls-remote",
            "https://github.com/gluster/glusterfs.git",
            `refs/tags/${stableTag}`,
          ],
          { capture: true, timeout: 30000 },
        ),
      )
    ).stdout.split(/\s+/)[0];
  const rollingCommit = (
    await retryUpstream("Gluster devel branch", () =>
      run(
        "git",
        [
          "ls-remote",
          "https://github.com/gluster/glusterfs.git",
          "refs/heads/devel",
        ],
        { capture: true, timeout: 30000 },
      ),
    )
  ).stdout.split(/\s+/)[0];
  const baseImages = JSON.parse(
    env(
      "CONDUCTOR_BASE_IMAGES_JSON",
      JSON.stringify({
        centos:
          "quay.io/centos/centos:stream10@sha256:b7f85bb8be4c471bc62842156a51bbf224b15243943733bd54e86ba5fd79b1fc",
        rocky: "rockylinux/rockylinux:10",
        alma: "almalinux:10",
        oracle: "oraclelinux:10",
        debian:
          "debian:12-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241",
        ubuntu: "ubuntu:24.04",
      }),
    ),
  );
  const dockerHubQuota = await checkDockerHubRateLimit(
    Object.values(baseImages),
  );
  if (dockerHubQuota.checked)
    log(
      "Docker Hub quota",
      dockerHubQuota.remaining === null || dockerHubQuota.limit === null
        ? "quota headers unavailable"
        : `${dockerHubQuota.remaining}/${dockerHubQuota.limit} remaining`,
    );
  const resolveBase = async (name, reference) => {
    if (/@sha256:[0-9a-f]{64}$/.test(reference)) return reference;
    return retryUpstream(`Base image ${name} (${reference})`, async () => {
      try {
        const inspectArgs = ["inspect"];
        const authFile = dockerAuthFile();
        if (isDockerHubReference(reference) && authFile)
          inspectArgs.push("--authfile", authFile);
        inspectArgs.push("--format", "{{.Digest}}", `docker://${reference}`);
        const digest = (
          await run("skopeo", inspectArgs, {
            capture: true,
            timeout: 30000,
          })
        ).stdout.trim();
        if (/^sha256:[0-9a-f]{64}$/.test(digest))
          return `${reference}@${digest}`;
      } catch {}
      const manifest = JSON.parse(
        (
          await run(
            "docker",
            [
              "buildx",
              "imagetools",
              "inspect",
              "--format",
              "{{json .Manifest}}",
              reference,
            ],
            { capture: true, timeout: 30000 },
          )
        ).stdout,
      );
      if (/^sha256:[0-9a-f]{64}$/.test(manifest.digest))
        return `${reference}@${manifest.digest}`;
      throw new Error(`registry returned no immutable digest for ${reference}`);
    }).catch((error) => {
      throw new Error(
        `could not resolve immutable base-image digest: ${reference}`,
        { cause: error },
      );
    });
  };
  for (const [name, reference] of Object.entries(baseImages))
    baseImages[name] = await resolveBase(name, reference);
  const inputs = {
    stableTag,
    sourceCommit,
    rollingCommit,
    baseImages,
    checked: new Date().toISOString(),
  };
  log(
    "upstream check complete",
    `stable=${stableTag} stable_commit=${sourceCommit.slice(0, 12)} rolling_commit=${rollingCommit.slice(0, 12)}`,
  );
  const date = dateStamp();
  const allLanes = buildLanes({
    stableTag,
    sourceCommit,
    rollingCommit,
    date,
  });
  const selectedLaneIds = env(
    "CONDUCTOR_LANES",
    "epel10-stable,debian-stable,ubuntu-stable,epel10-rolling,debian-rolling,ubuntu-rolling",
  )
    .split(",")
    .map((lane) => lane.trim())
    .filter(Boolean);
  const lanes = allLanes.filter((lane) => selectedLaneIds.includes(lane.id));
  if (!lanes.length)
    throw new Error(
      `no conductor lanes selected: ${selectedLaneIds.join(",")}`,
    );
  log("lane selection", selectedLaneIds.join(","));
  const baseDigest = (lane) => baseImages[lane.baseKey];
  const packageInputsMatch = (checkpoint, lane) =>
    !force && packageCheckpointInputsMatch(checkpoint, lane);
  const imageInputsMatch = ({
    checkpoint,
    lane,
    distribution,
    baseKey,
    provenanceExists,
    packageCandidate,
  }) =>
    isImageCheckpointValid({
      checkpoint,
      lane,
      distribution,
      baseImage: baseImages[baseKey],
      packageCandidate:
        packageCandidate ||
        checkpoint?.package_candidate ||
        `${lane.id}-${lane.version}`,
      provenanceExists,
      force,
    });
  const stageCheckpoints = new Map();
  let checkpointWrite = Promise.resolve();
  // Builds and image workflows may run concurrently, but publication is a
  // single-writer operation. Keep the queue alive after a failed item so one
  // failed lane does not strand later lanes behind a rejected promise.
  let publicationQueue = Promise.resolve();
  const enqueuePublication = (label, task) => {
    const operation = publicationQueue.then(async () => {
      log(`${label}: publication started`);
      const result = await task();
      log(`${label}: publication finished`);
      return result;
    });
    publicationQueue = operation.catch((error) => {
      void notifyFailure(`${label} publication failed`, error, [
        { name: "Run", value: runId },
      ]);
      log(`${label}: publication failed`, error.message || String(error));
    });
    return operation;
  };
  const saveStageCheckpoint = (lane, checkpoint) => {
    stageCheckpoints.set(lane.id, checkpoint);
    checkpointWrite = checkpointWrite.then(async () => {
      const state = await readJson(stateFile, previous);
      state.checkpoints = {
        ...state.checkpoints,
        [lane.id]: checkpoint,
      };
      await atomicWrite(stateFile, JSON.stringify(state, null, 2) + "\n");
    });
    return checkpointWrite;
  };
  const publishedPackageRoot = (lane) => {
    const root = env("PUBLISH_ROOT", "/var/lib/gluster-packaging/repository");
    const candidate = `${lane.id}-${lane.version}`;
    if (lane.format === "rpm")
      return path.join(
        root,
        "el10",
        "x86_64",
        lane.channel === "preview" ? "previews" : "stable",
        ...(lane.channel === "preview" ? [candidate] : []),
      );
    return path.join(
      root,
      lane.distribution,
      lane.suite,
      "amd64",
      lane.channel === "preview" ? "previews" : "stable",
      ...(lane.channel === "preview" ? [candidate] : []),
    );
  };
  const publishedRepositoryPath = (lane) =>
    path.join(
      publishedPackageRoot(lane),
      lane.format === "rpm" ? "repodata/repomd.xml" : "dists/stable/Release",
    );
  const publishedPackage = async (lane, checkpoint) => {
    const checkpointPackage =
      checkpoint?.package && packageInputsMatch(checkpoint.package, lane)
        ? checkpoint.package
        : null;
    if (!checkpointPackage) return null;
    const root = env("PUBLISH_ROOT", "/var/lib/gluster-packaging/repository");
    let packageRoot = publishedPackageRoot(lane);
    const metadataName =
      lane.format === "rpm" ? "repodata/repomd.xml" : "dists/stable/Release";
    const packageMatches = async (directory) => {
      const metadata = path.join(directory, metadataName);
      const provenance = path.join(directory, "provenance.json");
      if (!(await exists(metadata)) || !(await exists(provenance)))
        return false;
      try {
        const document = JSON.parse(await readFile(provenance, "utf8"));
        const record = document.record || document;
        return (
          record.candidate_id === checkpointPackage.candidate_id &&
          record.source?.commit === lane.sourceCommit
        );
      } catch {
        return false;
      }
    };
    if (!(await packageMatches(packageRoot)) && lane.channel === "preview") {
      const previewsRoot = path.dirname(packageRoot);
      for (const entry of await readdir(previewsRoot, {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const candidateRoot = path.join(previewsRoot, entry.name);
        if (await packageMatches(candidateRoot)) {
          packageRoot = candidateRoot;
          log(`${lane.id}: reused package checkpoint`, entry.name);
          break;
        }
      }
    }
    if (!(await packageMatches(packageRoot))) {
      log(
        `${lane.id}: package checkpoint stale`,
        `no published package for commit ${lane.sourceCommit.slice(0, 12)}`,
      );
      return null;
    }
    const provenance = path.join(packageRoot, "provenance.json");
    const relativeRoot = path
      .relative(root, packageRoot)
      .split(path.sep)
      .join("/");
    const candidate = {
      ...checkpointPackage,
      published_root: packageRoot,
      repository: `/${relativeRoot}/`,
      provenance: `/${relativeRoot}/provenance.json`,
    };
    try {
      await run(
        "node",
        [
          path.join(repoRoot, "scripts/verify-provenance.mjs"),
          path.dirname(provenance),
        ],
        { capture: true },
      );
    } catch (error) {
      log(`${lane.id}: package provenance invalid`, error.message);
      return null;
    }
    return candidate;
  };
  const packageRepositoryUrl = (
    lane,
    candidate = `${lane.id}-${lane.version}`,
  ) =>
    lane.format === "rpm"
      ? `/el10/x86_64/${lane.channel === "preview" ? `previews/${candidate}` : "stable"}/`
      : `/${lane.distribution}/${lane.suite}/amd64/${lane.channel === "preview" ? `previews/${candidate}` : "stable"}/`;
  const writeProvenance = async (
    lane,
    candidate,
    result,
    validationFile,
    smoke2 = [],
  ) => {
    const recordFile = path.join(candidate, ".provenance-record.json");
    let validation = null;
    try {
      validation = JSON.parse(await readFile(validationFile, "utf8"));
    } catch {}
    const record = {
      kind: "package",
      run_id: runId,
      lane: lane.id,
      channel: lane.channel,
      version: lane.version,
      package_version: lane.packageVersion,
      candidate,
      candidate_id: `${lane.id}-${lane.version}`,
      repository: packageRepositoryUrl(
        lane,
        lane.channel === "preview" ? `${lane.id}-${lane.version}` : "stable",
      ),
      provenance: `${packageRepositoryUrl(lane, lane.channel === "preview" ? `${lane.id}-${lane.version}` : "stable")}provenance.json`,
      source: { ref: lane.sourceRef, commit: lane.sourceCommit },
      packaging_commit: (
        await run("git", ["rev-parse", "HEAD"], {
          capture: true,
          cwd: repoRoot,
        })
      ).stdout.trim(),
      workflow: result.workflow || lane.workflow,
      workflow_run_id: result.run_id || null,
      workflow_url: result.run_id
        ? `https://github.com/eliware/glusterfs-packaging/actions/runs/${result.run_id}`
        : null,
      validation,
      smoke2,
    };
    await writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`);
    log(`${lane.id}: package provenance record prepared`);
  };
  const writeImageProvenance = async (
    lane,
    imageResult,
    distribution,
    packageProvenanceUrl,
  ) => {
    const publicationRoot = env(
      "PUBLISH_ROOT",
      "/var/lib/gluster-packaging/repository",
    );
    const outputDir = path.join(
      publicationRoot,
      "metadata",
      "runs",
      runId,
      lane.id,
      distribution,
    );
    const recordFile = path.join(outputDir, ".provenance-record.json");
    const validationFile = path.join(outputDir, "container-validation.json");
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      validationFile,
      `${JSON.stringify(imageResult.container_validation || {}, null, 2)}\n`,
    );
    await writeFile(
      recordFile,
      `${JSON.stringify(
        {
          kind: "image",
          run_id: runId,
          lane: lane.id,
          channel: lane.channel,
          version: lane.version,
          distribution,
          image: imageResult.image,
          digest: imageResult.digest,
          package_provenance: packageProvenanceUrl,
          package_repository:
            imageResult.rpm_repo_url || imageResult.deb_repo_url || null,
          package_metadata_sha256: imageResult.rpm_metadata_sha256 || null,
          source: { ref: lane.sourceRef, commit: lane.sourceCommit },
          packaging_commit: imageResult.packaging_commit || null,
          base_image_digest: imageResult.base_image_digest || null,
          workflow: imageResult.workflow || null,
          workflow_run_id: imageResult.run_id || null,
          build_log: imageResult.build_log || null,
          workflow_url: imageResult.run_id
            ? `https://github.com/eliware/glusterfs-packaging/actions/runs/${imageResult.run_id}`
            : null,
        },
        null,
        2,
      )}\n`,
    );
    const args = [
      path.join(repoRoot, "scripts/write-provenance.mjs"),
      "--output-dir",
      outputDir,
      "--record-json",
      recordFile,
      "--asset",
      "container-validation",
      validationFile,
    ];
    if (imageResult.build_log && (await exists(imageResult.build_log)))
      args.push("--asset", "image-build-log", imageResult.build_log);
    await runInteractive("node", args, { env: process.env });
    await runInteractive("node", [
      path.join(repoRoot, "scripts/verify-provenance.mjs"),
      outputDir,
    ]);
    await rm(recordFile, { force: true });
    await rm(validationFile, { force: true });
    return `/metadata/runs/${runId}/${lane.id}/${distribution}/provenance.json`;
  };
  const runLane = async (lane) => {
    const prior = previous.checkpoints[lane.id] || {};
    let checkpoint = stageCheckpoints.get(lane.id) || prior;
    let packageCheckpoint = await publishedPackage(lane, checkpoint);
    const pendingPackage = checkpoint.package_candidate;
    const pendingPackageValid =
      !packageCheckpoint &&
      !force &&
      ["smoke2-pending", "smoke2-passed"].includes(pendingPackage?.status) &&
      pendingPackage.source_commit === lane.sourceCommit &&
      (await exists(pendingPackage.candidate_dir));
    let result;
    let smoke;
    let candidate;
    let validationFile;
    let validationTemp;
    let packageRecord;
    let smoke2 = [];
    if (packageCheckpoint) {
      result = packageCheckpoint.build || {};
      smoke = packageCheckpoint.validation;
      smoke2 = packageCheckpoint.smoke2 || [];
      validationTemp = await tempDir("gluster-validation-");
      validationFile = path.join(validationTemp, "validation.json");
      await writeFile(validationFile, JSON.stringify(smoke, null, 2) + "\n");
      log(`${lane.id}: package skipped`, "checkpoint valid");
    } else if (pendingPackageValid) {
      candidate = pendingPackage.candidate_dir;
      result = pendingPackage.build || {};
      smoke = pendingPackage.validation;
      smoke2 = pendingPackage.smoke2 || [];
      validationFile = path.join(candidate, "validation.json");
      log(`${lane.id}: package build skipped`, "resuming after smoke-2");
    } else {
      if (noRebuild)
        throw new Error(
          `${lane.id}: checkpoint invalid and --no-rebuild is set`,
        );
      log(
        `${lane.id}: queued`,
        `source=${lane.sourceRef} commit=${lane.sourceCommit.slice(0, 12)}`,
      );
      candidate = path.join(workspaceRoot, runId, lane.id);
      const workspace = path.join(workspaceRoot, "workspaces", lane.id);
      const fields = {
        channel: lane.channel === "preview" ? "rolling" : "stable",
        source_ref: lane.sourceRef,
        source_commit: lane.sourceCommit,
        gluster_version: lane.version,
        package_version: lane.packageVersion,
        candidate_id: `${lane.id}-${lane.version}`,
        workspace_dir: workspace,
        candidate_dir: candidate,
        conductor_run_id: runId,
        ...(lane.format === "deb"
          ? { target_os: lane.distribution, deb_suite: lane.suite }
          : {}),
      };
      result = await dispatch(lane.workflow, "package-build-result", fields);
      log(`${lane.id}: package build passed`, `candidate=${candidate}`);
      smoke = dryRun ? { dry_run: true, internal: true } : result.validation;
      if (!smoke)
        throw new Error(
          `${lane.id}: no package smoke-test result was returned`,
        );
      if (!dryRun)
        assertValidationRecord(smoke, {
          coreField: "package_core",
          label: `${lane.id} package`,
        });
      if (result.validation)
        log(`${lane.id}: internal package smoke test passed`);
      validationFile = path.join(candidate, "validation.json");
      if (!dryRun)
        await writeFile(validationFile, JSON.stringify(smoke, null, 2) + "\n");
    }
    const smokeWorkspace =
      candidate || path.join(workspaceRoot, runId, lane.id, "smoke-2");
    if (!smoke2.length || !packageSmoke2Complete({ smoke2 }, lane))
      smoke2 = await runPackageSmoke2({
        lane,
        packageRoot: candidate || packageCheckpoint.published_root,
        smokeWorkspace,
        candidateRoot: candidate,
        priorRecords: smoke2,
        onResult: async (record, records) => {
          if (!candidate || dryRun || skipPublication) return;
          await saveStageCheckpoint(lane, {
            ...checkpoint,
            package_candidate: {
              status: "smoke2-pending",
              source_commit: lane.sourceCommit,
              base_image: baseDigest(lane),
              candidate_dir: candidate,
              validation: mergePackageValidation(smoke, [record]),
              smoke2: records,
              build: result,
            },
          });
        },
        dryRun,
        localStatus,
        withLocalStageLock,
        log,
        repoRoot,
        runId,
      });
    if (dryRun)
      await logPlannedImages({ checkpoint, imageInputsMatch, lane, log });
    if (!dryRun) {
      smoke = mergePackageValidation(smoke, smoke2);
      validationFile =
        validationFile || path.join(smokeWorkspace, "validation.json");
      await mkdir(path.dirname(validationFile), { recursive: true });
      await writeFile(validationFile, JSON.stringify(smoke, null, 2) + "\n");
      if (candidate) {
        await writeFile(
          path.join(candidate, "smoke-2.json"),
          JSON.stringify(smoke2, null, 2) + "\n",
        );
        if (!skipPublication)
          await writeProvenance(
            lane,
            candidate,
            result,
            validationFile,
            smoke2,
          );
        if (!skipPublication) {
          checkpoint = {
            ...checkpoint,
            package_candidate: {
              status: "smoke2-passed",
              source_commit: lane.sourceCommit,
              base_image: baseDigest(lane),
              candidate_dir: candidate,
              validation: smoke,
              smoke2,
              build: result,
            },
          };
          await saveStageCheckpoint(lane, checkpoint);
        }
      }
      if (!packageCheckpoint) {
        packageRecord = {
          status: skipPublication ? "candidate" : "published",
          source_commit: lane.sourceCommit,
          base_image: baseDigest(lane),
          version: lane.version,
          package_version: lane.packageVersion,
          candidate_id: `${lane.id}-${lane.version}`,
          provenance: `${packageRepositoryUrl(lane)}provenance.json`,
          validation: smoke,
          smoke1: result.validation || null,
          smoke2,
          build: result,
        };
        if (lane.format === "rpm" && !skipPublication)
          packageRecord.rpm_metadata_sha256 = (
            await run(
              "sha256sum",
              [path.join(candidate, "rpm/repodata/repomd.xml")],
              { capture: true },
            )
          ).stdout.split(/\s+/)[0];
      }
    }
    let images = [];
    const recordImage = async (
      imageResult,
      distribution,
      provenanceUrl,
      imageBaseKey,
      packageProvenanceUrl,
    ) => {
      if (!imageResult?.image || !imageResult?.digest)
        throw new Error(
          `image workflow returned no immutable digest for ${distribution}`,
        );
      const active = JSON.parse(
        await readFile(
          path.join(
            env("PUBLISH_ROOT", "/var/lib/gluster-packaging/repository"),
            "metadata/active-generation.json",
          ),
          "utf8",
        ),
      );
      const publicationRoot = env(
        "PUBLISH_ROOT",
        "/var/lib/gluster-packaging/repository",
      );
      const output = path.join(
        publicationRoot,
        "metadata",
        `catalog.json.${runId}-${lane.id}-${distribution}.next`,
      );
      const containerValidationDir = await tempDir(
        "gluster-container-validation-",
      );
      const containerValidationFile = path.join(
        containerValidationDir,
        "container-validation.json",
      );
      await writeFile(
        containerValidationFile,
        `${JSON.stringify(imageResult.container_validation, null, 2)}\n`,
      );
      try {
        await enqueuePublication(`${lane.id}/${distribution}`, async () => {
          await runInteractive(
            "node",
            [
              path.join(repoRoot, "scripts/write-catalog.mjs"),
              "--output",
              output,
              "--publish-root",
              publicationRoot,
              "--channel",
              lane.channel,
              "--version",
              lane.version,
              "--built",
              new Date().toISOString(),
              "--image",
              imageResult.image,
              "--digest",
              imageResult.digest,
              "--candidate",
              `${lane.id}-${lane.version}`,
              "--package-candidate",
              `${lane.id}-${lane.version}`,
              "--generation",
              active.generation,
              "--source-ref",
              lane.sourceRef,
              "--source-commit",
              lane.sourceCommit,
              "--validation-file",
              validationFile,
              "--container-validation-file",
              containerValidationFile,
              "--distribution",
              distribution,
              "--provenance",
              provenanceUrl,
              "--package-provenance",
              packageProvenanceUrl,
              "--base-image-digest",
              imageResult.base_image_digest ||
                baseImages[imageBaseKey].split("@").at(-1),
              "--base-image",
              imageResult.base_image || baseImages[imageBaseKey],
            ],
            { env: process.env },
          );
          await rename(
            output,
            path.join(publicationRoot, "metadata/catalog.json"),
          );
          await runInteractive("node", [
            path.join(repoRoot, "scripts/generate-repository-index.mjs"),
            "--root",
            publicationRoot,
          ]);
          await runInteractive("node", [
            path.join(repoRoot, "scripts/write-release-manifest.mjs"),
            "--root",
            publicationRoot,
            "--generation",
            active.generation,
          ]);
        });
      } finally {
        await rm(containerValidationDir, { recursive: true, force: true });
      }
    };
    if (candidate && !dryRun && !skipPublication) {
      await enqueuePublication(lane.id, async () => {
        await runInteractive(
          "node",
          [
            path.join(repoRoot, "scripts/publish-package-candidate.mjs"),
            lane.channel,
            `${lane.id}-${lane.version}`,
            candidate,
          ],
          { env: process.env },
        );
      });
      log(`${lane.id}: packages published`);
    } else if (!packageCheckpoint)
      log(`${lane.id}: publication skipped`, dryRun ? "dry-run" : "no-publish");
    if (packageRecord) {
      const publishedCheckpoint = { ...checkpoint, package: packageRecord };
      delete publishedCheckpoint.package_candidate;
      checkpoint = publishedCheckpoint;
      await saveStageCheckpoint(lane, checkpoint);
      await notifyConductor({
        title: `${lane.id} package checkpoint passed`,
        description:
          "Package build, smoke test, provenance, signing, and publication completed.",
        status: "success",
        fields: [
          { name: "Version", value: lane.version },
          { name: "Format", value: lane.format },
          { name: "Source", value: lane.sourceCommit.slice(0, 12) },
        ],
      });
    }
    if (!dryRun) {
      const repositoryBase = env(
        "REPOSITORY_BASE_URL",
        "https://glusterfs.eliware.org",
      );
      const packageRepository =
        packageCheckpoint?.repository ||
        packageRepositoryUrl(
          lane,
          lane.channel === "preview" ? `${lane.id}-${lane.version}` : "stable",
        );
      const packageProvenance = `${packageRepository}provenance.json`;
      const packageProvenanceUrl = `${repositoryBase}${packageProvenance}`;
      const publishedCandidate = packageCandidateForPublication(
        lane,
        packageCheckpoint,
        packageRecord,
      );
      const rpmRepoUrl = `${repositoryBase}${packageRepository}`;
      const debRepository = () => `${repositoryBase}${packageRepository}`;
      let publishedRpmMetadataSha256;
      if (!skipPublication) {
        const publishedMetadata = packageCheckpoint?.published_root
          ? path.join(
              packageCheckpoint.published_root,
              lane.format === "rpm"
                ? "repodata/repomd.xml"
                : "dists/stable/Release",
            )
          : publishedRepositoryPath(lane);
        if (!(await exists(publishedMetadata)))
          throw new Error(
            `${lane.id}: published package metadata is missing at ${publishedMetadata}`,
          );
        if (lane.format === "rpm") {
          publishedRpmMetadataSha256 = (
            await run("sha256sum", [publishedMetadata], { capture: true })
          ).stdout.split(/\s+/)[0];
          log(
            `${lane.id}: verified published RPM metadata`,
            publishedRpmMetadataSha256,
          );
        } else
          log(`${lane.id}: verified published DEB metadata`, publishedMetadata);
      }
      const imageTargets = imageTargetsForLane(lane);
      const imageJobs = [];
      for (const [distribution, baseKey, repositoryName] of imageTargets) {
        const imageCheckpoint = checkpoint.images?.[distribution];
        const imageProvenance =
          imageCheckpoint?.provenance || imageCheckpoint?.result?.provenance;
        const imageProvenanceExists = imageProvenance
          ? await exists(
              publicationFile(
                env("PUBLISH_ROOT", "/var/lib/gluster-packaging/repository"),
                imageProvenance,
              ),
            )
          : false;
        if (
          imageInputsMatch({
            checkpoint: imageCheckpoint,
            lane,
            distribution,
            baseKey,
            packageCandidate:
              checkpoint.package?.candidate_id ||
              checkpoint.package_candidate ||
              `${lane.id}-${lane.version}`,
            provenanceExists: imageProvenanceExists,
          })
        ) {
          images.push(imageCheckpoint.result);
          log(`${lane.id}: image skipped`, `${distribution} checkpoint valid`);
          continue;
        }
        imageJobs.push({
          distribution,
          baseKey,
          repositoryName,
        });
      }
      const imageResults = dryRun
        ? []
        : await Promise.allSettled(
            imageJobs.map(async ({ distribution, baseKey, repositoryName }) => {
              const image = `ghcr.io/eliware/${repositoryName}:${lane.version}`;
              const imageCandidateId = `${lane.id}-${lane.version}-${distribution}`;
              const fields =
                lane.format === "rpm"
                  ? {
                      channel:
                        lane.channel === "preview" ? "preview" : "stable",
                      version: lane.version,
                      rpm_repo_url: rpmRepoUrl,
                      rpm_metadata_sha256: skipPublication
                        ? "mock"
                        : publishedRpmMetadataSha256,
                      package_candidate: publishedCandidate,
                      package_provenance: packageProvenanceUrl,
                      image_tag: image,
                      image_aliases:
                        lane.channel === "stable" ? lane.version : "",
                      base_image_digest: baseImages[baseKey].split("@").at(-1),
                      base_image: baseImages[baseKey],
                      source_ref: lane.sourceRef,
                      source_commit: lane.sourceCommit,
                      workspace_dir: workspaceRoot,
                      candidate_id: imageCandidateId,
                      packaging_commit: (
                        await run("git", ["rev-parse", "HEAD"], {
                          capture: true,
                          cwd: repoRoot,
                        })
                      ).stdout.trim(),
                    }
                  : {
                      channel:
                        lane.channel === "preview" ? "preview" : "stable",
                      version: lane.version,
                      deb_repo_url: debRepository(distribution, lane.suite),
                      package_candidate: publishedCandidate,
                      package_provenance: packageProvenanceUrl,
                      image_tag: image,
                      base_image_digest: baseImages[baseKey].split("@").at(-1),
                      base_image: baseImages[baseKey],
                      source_ref: lane.sourceRef,
                      source_commit: lane.sourceCommit,
                      workspace_dir: workspaceRoot,
                      candidate_id: imageCandidateId,
                      packaging_commit: (
                        await run("git", ["rev-parse", "HEAD"], {
                          capture: true,
                          cwd: repoRoot,
                        })
                      ).stdout.trim(),
                    };
              const imageResultFile = path.join(
                workspaceRoot,
                runId,
                lane.id,
                `image-${distribution}.json`,
              );
              const imageBuildLog = path.join(
                workspaceRoot,
                runId,
                lane.id,
                "logs",
                `image-${distribution}.log`,
              );
              const status = localStatus(
                `${lane.id}-image-${distribution}`,
                `${lane.id} image ${distribution}`,
                "image-build",
              );
              await mkdir(path.dirname(imageResultFile), { recursive: true });
              await status.update({
                state: "queued",
                percent: 0,
                eta: "pending",
                log: "0/0",
                log_file: imageBuildLog,
              });
              log(
                `${lane.id}: local image build starting`,
                `${distribution} ${image}`,
              );
              try {
                await withLocalStageLock("image-build", async () => {
                  await status.update({
                    state: "in_progress",
                    percent: 50,
                    eta: "running",
                    log: "0/0",
                    log_file: imageBuildLog,
                  });
                  await run(
                    "node",
                    [
                      path.join(
                        repoRoot,
                        "scripts/build-publish-image-local.mjs",
                      ),
                    ],
                    {
                      capture: true,
                      env: {
                        ...process.env,
                        IMAGE: image,
                        IMAGE_ALIASES:
                          lane.channel === "stable" ? lane.version : "",
                        IMAGE_RESULT: imageResultFile,
                        IMAGE_BUILD_LOG: imageBuildLog,
                        DOCKERFILE:
                          distribution === "oracle"
                            ? path.join(
                                repoRoot,
                                "containers/oracle10-gluster.Dockerfile",
                              )
                            : lane.format === "deb"
                              ? path.join(
                                  repoRoot,
                                  "containers/debian12-gluster.Dockerfile",
                                )
                              : path.join(
                                  repoRoot,
                                  "containers/centos10-gluster.Dockerfile",
                                ),
                        PACKAGE_FORMAT: lane.format,
                        DISTRIBUTION: distribution,
                        VERSION: lane.version,
                        BASE_IMAGE: baseImages[baseKey],
                        BASE_IMAGE_DIGEST: baseImages[baseKey]
                          .split("@")
                          .at(-1),
                        PACKAGING_COMMIT: fields.packaging_commit,
                        SOURCE_REF: lane.sourceRef,
                        SOURCE_COMMIT: lane.sourceCommit,
                        PACKAGE_CANDIDATE: publishedCandidate,
                        PACKAGE_PROVENANCE: packageProvenanceUrl,
                        RPM_REPO_URL: fields.rpm_repo_url || "",
                        RPM_METADATA_SHA256: fields.rpm_metadata_sha256 || "",
                        DEB_REPO_URL: fields.deb_repo_url || "",
                        CONTAINER_RUNTIME: env("CONTAINER_RUNTIME", "docker"),
                        PUBLISH_IMAGE: skipPublication ? "0" : "1",
                        CONDUCTOR_RUN_ID: runId,
                      },
                    },
                  );
                });
                await status.update({
                  state: "success",
                  percent: 100,
                  eta: "complete",
                  log: "1/1",
                });
              } catch (error) {
                await status.update({
                  state: "failure",
                  percent: 100,
                  eta: "failed",
                  log: "0/1",
                  error: error.message,
                });
                throw error;
              }
              const imageResult = JSON.parse(
                await readFile(imageResultFile, "utf8"),
              );
              if (!imageResult.container_validation)
                throw new Error(
                  `${lane.id}/${distribution}: no container validation result was returned`,
                );
              assertValidationRecord(imageResult.container_validation, {
                coreField: "container_core",
                label: `${lane.id}/${distribution} image`,
              });
              imageResult.container_validation = markPublicationVerified(
                imageResult.container_validation,
                "published package metadata and image inputs verified",
              );
              const provenanceUrl = skipPublication
                ? ""
                : await writeImageProvenance(
                    lane,
                    imageResult,
                    distribution,
                    packageProvenanceUrl,
                  );
              if (!skipPublication)
                await recordImage(
                  imageResult,
                  distribution,
                  provenanceUrl,
                  baseKey,
                  packageProvenanceUrl,
                );
              return {
                distribution,
                imageResult: { ...imageResult, provenance: provenanceUrl },
                imageCheckpoint: {
                  status: "published",
                  source_commit: lane.sourceCommit,
                  package_candidate: publishedCandidate,
                  base_image: baseImages[baseKey],
                  distribution,
                  provenance: provenanceUrl,
                  result: imageResult,
                },
              };
            }),
          );
      for (const imageResult of imageResults) {
        if (imageResult.status === "rejected") throw imageResult.reason;
        const {
          distribution,
          imageResult: resultImage,
          imageCheckpoint,
        } = imageResult.value;
        images.push(resultImage);
        checkpoint = {
          ...checkpoint,
          images: {
            ...checkpoint.images,
            [distribution]: imageCheckpoint,
          },
        };
        await saveStageCheckpoint(lane, checkpoint);
        log(`${lane.id}: image passed`, distribution);
        await notifyConductor({
          title: `${lane.id} ${distribution} image checkpoint passed`,
          description:
            "Image build, smoke test, provenance, and publication completed.",
          status: "success",
          fields: [
            { name: "Version", value: lane.version },
            { name: "Image", value: resultImage.image },
            {
              name: "Digest",
              value: `${resultImage.digest.slice(0, 19)}…`,
            },
          ],
        });
      }
    }
    if (!dryRun && !skipPublication && candidate) {
      await rm(candidate, { recursive: true, force: true });
      if (result.build_log) await rm(result.build_log, { force: true });
      log(`${lane.id}: cleaned candidate and build log`);
    }
    if (validationTemp)
      await rm(validationTemp, { recursive: true, force: true });
    return {
      id: lane.id,
      status: "published",
      source_commit: lane.sourceCommit,
      base_image: baseDigest(lane),
      candidate,
      build: result,
      smoke,
      images: checkpoint.images || {},
      package: checkpoint.package,
      image_results: images,
      changed: Boolean(candidate || images.length),
    };
  };
  const dispatch = async (workflow, artifact, fields) => {
    if (dryRun) return { dry_run: true, workflow, fields };
    const label =
      fields.candidate_id ||
      [fields.channel, fields.version, fields.distribution]
        .filter(Boolean)
        .join("/") ||
      workflow;
    const source = fields.source_commit
      ? `source=${String(fields.source_commit).slice(0, 12)}`
      : "";
    log(`${label}: dispatch started`, `${workflow} ${source}`.trim());
    const args = [
      path.join(repoRoot, "scripts/dispatch-workflow.mjs"),
      "--workflow",
      workflow,
      "--artifact",
      artifact,
    ];
    for (const [name, value] of Object.entries(fields))
      args.push(`--${name}`, value);
    let result;
    try {
      result = await run("node", args, {
        capture: true,
        stream: true,
        env: {
          ...process.env,
          CONDUCTOR_STATUS_DIR: statusDirectory,
          CONDUCTOR_RUN_ID: runId,
        },
      });
    } catch (error) {
      log(`${label}: dispatch failed`, `${workflow} ${error.message}`);
      await notifyFailure(`${label} dispatch failed`, error, [
        { name: "Workflow", value: workflow },
      ]);
      throw error;
    }
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    const output = JSON.parse(lines.at(-1));
    log(
      `${label}: dispatch completed`,
      `${workflow} run=${output.run_id || "unknown"} artifact=${artifact}`,
    );
    return output;
  };
  const results = await Promise.allSettled(lanes.map(runLane));
  if (
    !dryRun &&
    results.every(
      (result) => result.status === "fulfilled" && !result.value.changed,
    )
  )
    throw new NoOpRun(runId, inputs, results);
  const checkpoints = { ...previous.checkpoints };
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const lane = lanes[i];
    if (result.status === "fulfilled") checkpoints[lane.id] = result.value;
    else {
      const error = result.reason?.stack || String(result.reason);
      log(`${lane.id}: failed`, error.split("\n", 1)[0]);
      await notifyFailure(`${lane.id} failed`, result.reason, [
        { name: "Run", value: runId },
      ]);
      checkpoints[lane.id] = {
        ...stageCheckpoints.get(lane.id),
        ...previous.checkpoints[lane.id],
        status: "failed",
        failed_at: new Date().toISOString(),
        error,
        source_commit: lane.sourceCommit,
        base_image: baseDigest(lane),
      };
    }
  }
  const next = {
    metadata_version: METADATA_VERSION,
    schema: 1,
    run_id: runId,
    inputs,
    checkpoints,
    runs: [
      ...(previous.runs || []),
      {
        run_id: runId,
        completed_at: new Date().toISOString(),
        results: results.map((r) =>
          r.status === "fulfilled"
            ? r.value
            : { status: "failed", error: String(r.reason) },
        ),
      },
    ].slice(-30),
  };
  if (!dryRun)
    await atomicWrite(stateFile, JSON.stringify(next, null, 2) + "\n");
  const validateFinalPublication = () =>
    validatePublishedArtifacts({
      results,
      lanes,
      publicationRoot: env(
        "PUBLISH_ROOT",
        "/var/lib/gluster-packaging/repository",
      ),
      publishedPackageRoot,
      log,
    });
  const rebuildPublishedCatalog = async () => {
    const publicationRoot = env(
      "PUBLISH_ROOT",
      "/var/lib/gluster-packaging/repository",
    );
    await runInteractive(
      "node",
      [
        path.join(repoRoot, "scripts/rebuild-catalog.mjs"),
        "--publish-root",
        publicationRoot,
        "--output",
        path.join(publicationRoot, "metadata/catalog.json"),
      ],
      { env: process.env },
    );
    log("catalog rebuilt from publication records");
  };
  if (!dryRun && !skipPublication) {
    try {
      await rebuildPublishedCatalog();
    } catch (error) {
      log("catalog rebuild failed", error.message);
      await notifyFailure("Catalog rebuild failed", error, [
        { name: "Run", value: runId },
      ]);
      process.exitCode = 1;
    }
  }
  const reconcileCatalog = async () => {
    const publicationRoot = env(
      "PUBLISH_ROOT",
      "/var/lib/gluster-packaging/repository",
    );
    const validationPaths = [
      "el10/x86_64/stable/validation.json",
      "debian/bookworm/amd64/stable/validation.json",
      "ubuntu/noble/amd64/stable/validation.json",
    ].map((relative) => path.join(publicationRoot, relative));
    const validations = [];
    for (const file of validationPaths) {
      try {
        validations.push(JSON.parse(await readFile(file, "utf8")));
      } catch {
        log("catalog reconciliation deferred", `missing ${file}`);
        return false;
      }
    }
    const distributions = Array.from(
      new Map(
        validations
          .flatMap((validation) => validation.distributions || [])
          .map((distribution) => [distribution.id, distribution]),
      ).values(),
    );
    const passed = validations.every(
      (validation) =>
        validation.repository_integrity?.status === "passed" &&
        validation.provenance_verification?.status === "passed" &&
        (validation.distributions || []).every(
          (distribution) => distribution.package_core?.status === "passed",
        ),
    );
    const validation = {
      metadata_version: METADATA_VERSION,
      generated: new Date().toISOString(),
      package_format: "multi-platform",
      repository_integrity: {
        status: passed ? "passed" : "failed",
        detail: "stable RPM and DEB repository validations reconciled",
      },
      provenance_verification: {
        status: passed ? "passed" : "failed",
        detail: "stable RPM and DEB provenance validations reconciled",
      },
      distributions,
    };
    const catalogPath = path.join(publicationRoot, "metadata/catalog.json");
    const stablePath = path.join(publicationRoot, "metadata/stable.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    const stable = JSON.parse(await readFile(stablePath, "utf8"));
    const withoutGenerated = (value) => {
      if (!value) return null;
      const copy = JSON.parse(JSON.stringify(value));
      delete copy.generated;
      return copy;
    };
    if (
      JSON.stringify(withoutGenerated(stable.validation)) ===
        JSON.stringify(withoutGenerated(validation)) &&
      JSON.stringify(withoutGenerated(catalog.stable?.validation)) ===
        JSON.stringify(withoutGenerated(validation))
    ) {
      log("catalog validation current");
      return false;
    }
    const updatedStable = {
      ...stable,
      validation,
      repository_integrity: validation.repository_integrity,
      provenance_verification: validation.provenance_verification,
    };
    const updatedCatalog = {
      ...catalog,
      generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      stable: updatedStable,
    };
    await atomicWrite(
      stablePath,
      `${JSON.stringify(updatedStable, null, 2)}\n`,
    );
    await atomicWrite(
      catalogPath,
      `${JSON.stringify(updatedCatalog, null, 2)}\n`,
    );
    log("catalog validation repaired", `${distributions.length} distributions`);
    return true;
  };
  if (!dryRun) {
    try {
      await reconcileCatalog();
    } catch (error) {
      log("catalog reconciliation failed", error.message);
      await notifyFailure("Catalog reconciliation failed", error, [
        { name: "Run", value: runId },
      ]);
      process.exitCode = 1;
    }
  }
  if (!dryRun && !skipPublication) {
    try {
      await validateFinalPublication();
    } catch (error) {
      log("final publication validation failed", error.message);
      await notifyFailure("Final publication validation failed", error, [
        { name: "Run", value: runId },
      ]);
      process.exitCode = 1;
    }
  }
  if (results.some((result) => result.status === "rejected"))
    process.exitCode = 1;
  log(
    "lane summary",
    results
      .map((result, index) => {
        const lane = lanes[index];
        if (result.status === "rejected") return `${lane.id}=failed`;
        const images = Object.keys(result.value.images || {}).length;
        return `${lane.id}=ok(${images} images)`;
      })
      .join(" "),
  );
  log(
    "run completed",
    results.filter((result) => result.status === "fulfilled").length +
      "/" +
      results.length +
      " lanes successful",
  );
  let report = null;
  if (!dryRun) {
    try {
      report = await generateReleaseReport({
        runId,
        results: next.runs.at(-1).results,
      });
      log("release report published", report.cardUrl);
    } catch (error) {
      log("release report failed", error.message);
    }
  }
  if (!dryRun)
    await notifyConductor({
      title: "Conductor run completed",
      description: results.some((result) => result.status === "rejected")
        ? "The release run completed with one or more failed lanes."
        : "The release run completed successfully; existing checkpoints were reused.",
      status: results.some((result) => result.status === "rejected")
        ? "failure"
        : "success",
      fields: [
        {
          name: "Run",
          value: runId,
        },
        {
          name: "Lanes",
          value: `${results.filter((result) => result.status === "fulfilled").length}/${results.length} successful`,
        },
      ],
      report,
    });
  console.log(
    JSON.stringify(
      { run_id: runId, inputs, results: next.runs.at(-1).results },
      null,
      2,
    ),
  );
} catch (error) {
  if (error instanceof NoOpRun) {
    completedNoOp = true;
    log("no-op run completed", "all package and image checkpoints were current");
    await notifyConductor({
      title: "Conductor no-op completed",
      description: "No upstream or build inputs changed; no artifacts were rebuilt.",
      status: "success",
      fields: [{ name: "Run", value: error.runId }],
    });
    console.log(
      JSON.stringify(
        { run_id: error.runId, inputs: error.inputs, no_op: true },
        null,
        2,
      ),
    );
    process.exitCode = 0;
  } else if (
    error instanceof DockerHubRateLimitError ||
    error instanceof GitHubRateLimitError
  ) {
    const waitMinutes = Math.ceil(error.retryAfterSeconds / 60);
    const service =
      error instanceof GitHubRateLimitError ? "GitHub API" : "Docker Hub";
    log("run deferred", `${error.message}; retry in about ${waitMinutes}m`);
    await notifyConductor({
      title: "Conductor run deferred",
      description: `No builds were started because ${service} rate limits prevented trustworthy preflight verification.`,
      status: "info",
      fields: [
        { name: "Reason", value: error.message },
        { name: "Retry", value: `in about ${waitMinutes} minutes` },
      ],
    });
    process.exitCode = 0;
  } else {
    throw error;
  }
} finally {
  if (statusReporter) clearInterval(statusReporter);
  if (statusDirectory)
    await rm(statusDirectory, { recursive: true, force: true });
  if (backupScript && !dryRun && !completedNoOp) {
    try {
      log("running repository backup");
      await run("node", [backupScript], { stream: true });
      log("repository backup completed");
    } catch (error) {
      log("repository backup failed", error.message);
      await notifyFailure("Repository backup failed", error);
      process.exitCode = 1;
    }
  }
  await rm(lockDir, { recursive: true, force: true });
}
