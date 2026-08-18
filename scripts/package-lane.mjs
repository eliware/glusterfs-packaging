import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { env, exists, run } from "./lib.mjs";
import { waitForCandidate } from "./candidate-readiness.mjs";
import {
  mergePackageSmoke2Records,
  packageSmoke2Passed,
  packageSmoke2Targets,
} from "./package-validation.mjs";
import { assertValidationRecord } from "./validation-schema.mjs";

export async function runPackageSmoke2({
  lane,
  packageRoot,
  smokeWorkspace,
  candidateRoot = null,
  priorRecords = [],
  onResult = async () => {},
  dryRun,
  localStatus,
  withLocalStageLock,
  log,
  repoRoot,
  runId,
}) {
  if (dryRun)
    return packageSmoke2Targets(lane).map((target_os) => ({
      target_os,
      validation: {
        dry_run: true,
        distributions: [{ id: target_os, package_core: { status: "passed" } }],
      },
    }));

  const packageDir = resolveSmokePackageDir(lane, packageRoot, candidateRoot);
  if (!(await exists(packageDir)))
    throw new Error(
      `${lane.id}: package directory for smoke-2 is missing: ${packageDir}`,
    );
  if (candidateRoot) {
    log(`${lane.id}: waiting for candidate visibility`, packageDir);
    const manifest = await waitForCandidate({
      candidateDir: candidateRoot,
      packageDir,
      timeoutMs: Number(env("CONDUCTOR_CANDIDATE_READY_TIMEOUT_MS", "120000")),
    });
    log(
      `${lane.id}: candidate visibility verified`,
      `${manifest.files.length} files`,
    );
  }

  const pendingTargets = packageSmoke2Targets(lane).filter(
    (target_os) =>
      !priorRecords.some((record) => packageSmoke2Passed(record, target_os)),
  );
  const results = await Promise.all(
    pendingTargets.map((target_os) =>
      runPackageSmoke2Target({
        lane,
        packageDir,
        smokeWorkspace,
        target_os,
        priorRecords,
        localStatus,
        withLocalStageLock,
        log,
        repoRoot,
        runId,
        onResult,
      }),
    ),
  );
  const merged = mergePackageSmoke2Records(lane, priorRecords, results);
  log(
    `${lane.id}: smoke-2 passed`,
    merged.map(({ target_os }) => target_os).join(","),
  );
  return merged;
}

function resolveSmokePackageDir(lane, packageRoot, candidateRoot) {
  if (lane.format === "rpm")
    return candidateRoot ? path.join(packageRoot, "rpm") : packageRoot;
  return candidateRoot
    ? path.join(
        packageRoot,
        "deb",
        lane.distribution,
        lane.suite,
        "amd64",
        lane.version,
      )
    : packageRoot;
}

async function runPackageSmoke2Target({
  lane,
  packageDir,
  smokeWorkspace,
  target_os,
  priorRecords,
  localStatus,
  withLocalStageLock,
  log,
  repoRoot,
  runId,
  onResult,
}) {
  const status = localStatus(
    `${lane.id}-smoke-2-${target_os}`,
    `${lane.id} smoke-2 ${target_os}`,
    "smoke-2",
  );
  const resultFile = path.join(smokeWorkspace, `smoke-2-${target_os}.json`);
  await mkdir(smokeWorkspace, { recursive: true });
  await status.update({
    state: "queued",
    percent: 0,
    eta: "pending",
    log: "0/0",
  });
  log(`${lane.id}: smoke-2 starting locally`, target_os);
  try {
    await withLocalStageLock("smoke-2", async () => {
      await status.update({
        state: "in_progress",
        percent: 50,
        eta: "running",
        log: "0/0",
      });
      await run(
        "node",
        [path.join(repoRoot, "scripts/run-local-package-smoke.mjs")],
        {
          capture: true,
          env: {
            ...process.env,
            PACKAGE_FORMAT: lane.format,
            REPO_DIR: packageDir,
            SMOKE_OS: target_os,
            SMOKE_RESULT: resultFile,
            CONTAINER_RUNTIME: env("CONTAINER_RUNTIME", "docker"),
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
  const validation = JSON.parse(await readFile(resultFile, "utf8"));
  assertValidationRecord(validation, {
    coreField: "package_core",
    label: `${lane.id}/${target_os} smoke-2`,
  });
  const record = {
    target_os,
    validation,
    workflow: "local-docker",
    run_id: runId,
  };
  await onResult(
    record,
    mergePackageSmoke2Records(lane, priorRecords, [record]),
  );
  return record;
}
