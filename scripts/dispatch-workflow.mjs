#!/usr/bin/env node
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { env, repoRoot, run, tempDir } from "./lib.mjs";
import {
  BUILD_POLL_INTERVAL_MS,
  estimateBuildProgress,
  formatEta,
} from "./progress-estimate.mjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i].startsWith("--"))
    args.set(process.argv[i].slice(2), process.argv[++i]);
}
const required = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
};
const workflow = required("workflow");
const artifact = required("artifact");
const ref = env("WORKFLOW_REF", "main");
const ghPath = env("GH_PATH", "gh");
const dispatchedAt = Date.now();
const ghAttempts = Number(env("CONDUCTOR_GH_ATTEMPTS", "5"));
const ghBackoffMs = Number(env("CONDUCTOR_GH_BACKOFF_MS", "2000"));
const statusCachePath = env(
  "CONDUCTOR_GH_STATUS_CACHE",
  "/mnt/pvc/gluster-build-workspaces/conductor/github-status.json",
);
const statusCacheTtlMs = Number(
  env("CONDUCTOR_GH_STATUS_CACHE_TTL_MS", "10000"),
);
const statusCacheLock = `${statusCachePath}.lock`;
const monitorTimeoutMs = Number(
  env("CONDUCTOR_WORKFLOW_TIMEOUT_MS", String(2 * 60 * 60 * 1000)),
);
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const errorText = (error) =>
  [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join("\n");
const isPermanentGitHubError = (error) => {
  const text = errorText(error);
  return (
    /HTTP (?:400|401|404|422)\b/i.test(text) ||
    /Unexpected inputs provided|workflow .* not found|not found/i.test(text)
  );
};
const runGh = async (args, label) => {
  let lastError;
  for (let attempt = 1; attempt <= ghAttempts; attempt += 1) {
    try {
      return await run(ghPath, args, { capture: true, cwd: repoRoot });
    } catch (error) {
      lastError = error;
      if (isPermanentGitHubError(error)) {
        const permanent = new Error(
          `GitHub rejected ${label}: ${errorText(error)}`,
        );
        permanent.code = "GITHUB_PERMANENT_ERROR";
        permanent.cause = error;
        throw permanent;
      }
      if (attempt === ghAttempts) break;
      const delay = Math.min(
        30000,
        ghBackoffMs * 2 ** (attempt - 1) + Math.round(Math.random() * 500),
      );
      console.error(
        `[conductor] GitHub retry ${label} attempt=${attempt}/${ghAttempts} wait=${Math.ceil(delay / 1000)}s`,
      );
      await sleep(delay);
    }
  }
  const exhausted = new Error(
    `GitHub ${label} failed after ${ghAttempts} attempts: ${errorText(lastError)}`,
  );
  exhausted.code = "GITHUB_RETRY_EXHAUSTED";
  exhausted.cause = lastError;
  throw exhausted;
};
const fields = {};
for (const [name, value] of args) {
  if (!["workflow", "artifact"].includes(name)) fields[name] = value;
}
const dispatchId = randomUUID();
const statusDirectory = env("CONDUCTOR_STATUS_DIR", "");
const statusPath = statusDirectory
  ? path.join(statusDirectory, `${dispatchId}.json`)
  : "";
const statusLabel = args.get("candidate_id") || workflow;
const writeStatus = async (status) => {
  if (!statusPath) return;
  await mkdir(statusDirectory, { recursive: true });
  await writeFile(
    `${statusPath}.tmp`,
    `${JSON.stringify(
      {
        label: statusLabel,
        sort_key: statusLabel,
        workflow,
        dispatch_id: dispatchId,
        updated: new Date().toISOString(),
        ...status,
      },
      null,
      2,
    )}\n`,
  );
  await rename(`${statusPath}.tmp`, statusPath);
};
fields.dispatch_id = dispatchId;
const dispatchArgs = [
  "workflow",
  "run",
  workflow,
  "--ref",
  ref,
  ...Object.entries(fields).flatMap(([name, value]) => [
    "-f",
    `${name}=${value}`,
  ]),
];
const listArgs = [
  "run",
  "list",
  "--workflow",
  workflow,
  "--event",
  "workflow_dispatch",
  "--limit",
  "50",
  "--json",
  "databaseId,createdAt,displayTitle,name,event,workflowName",
];
const findRun = async () => {
  const runs = JSON.parse(
    (await runGh(listArgs, `${workflow} run list`)).stdout,
  );
  return runs
    .filter(
      (item) =>
        Date.parse(item.createdAt) >= dispatchedAt - 30_000 &&
        item.event === "workflow_dispatch",
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .find((candidate) =>
      new RegExp(`(?:^|\\s)${dispatchId}(?:$|\\s)`).test(
        `${candidate.displayTitle || ""} ${candidate.name || ""}`,
      ),
    );
};

const readStatusCache = async () => {
  try {
    const [metadata, contents] = await Promise.all([
      stat(statusCachePath),
      readFile(statusCachePath, "utf8"),
    ]);
    const cache = JSON.parse(contents);
    if (metadata.mtimeMs + statusCacheTtlMs > Date.now()) return cache;
  } catch {}
  return null;
};
const refreshStatusCache = async (forceRefresh = false) => {
  await mkdir(path.dirname(statusCachePath), { recursive: true });
  let ownsLock = false;
  const lockWaitAttempts = Number(
    env("CONDUCTOR_GH_STATUS_LOCK_ATTEMPTS", "600"),
  );
  for (let attempt = 0; attempt < lockWaitAttempts && !ownsLock; attempt += 1) {
    try {
      await mkdir(statusCacheLock);
      ownsLock = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const lockAge = Date.now() - (await stat(statusCacheLock)).mtimeMs;
        if (
          lockAge > Number(env("CONDUCTOR_GH_STATUS_LOCK_STALE_MS", "120000"))
        ) {
          await rm(statusCacheLock, { recursive: true, force: true });
          continue;
        }
      } catch {}
      const cached = await readStatusCache();
      if (cached && !forceRefresh) return cached;
      await sleep(100);
    }
  }
  if (!ownsLock)
    throw new Error(
      `timed out waiting for GitHub status cache after ${Math.ceil((lockWaitAttempts * 100) / 1000)}s`,
    );
  try {
    const cached = await readStatusCache();
    if (cached && !forceRefresh) return cached;
    const runs = JSON.parse(
      (
        await runGh(
          [
            "run",
            "list",
            "--limit",
            "100",
            "--json",
            "databaseId,status,conclusion",
          ],
          "repository workflow status list",
        )
      ).stdout,
    );
    const cache = { runs, generated: new Date().toISOString() };
    await writeFile(statusCachePath, `${JSON.stringify(cache)}\n`);
    return cache;
  } finally {
    await rm(statusCacheLock, { recursive: true, force: true });
  }
};
const getRunStatus = async (runId) => {
  const cache = (await readStatusCache()) || (await refreshStatusCache());
  const runRecord = cache.runs.find(
    (candidate) => String(candidate.databaseId) === String(runId),
  );
  if (!runRecord) {
    const refreshed = await refreshStatusCache(true);
    return refreshed.runs.find(
      (candidate) => String(candidate.databaseId) === String(runId),
    );
  }
  return runRecord;
};
let dispatchAccepted = false;
for (let attempt = 1; attempt <= 3 && !dispatchAccepted; attempt += 1) {
  try {
    await runGh(dispatchArgs, `${workflow} dispatch`);
    dispatchAccepted = true;
  } catch (error) {
    // A transport error can happen after GitHub accepted the dispatch. Check
    // the dispatch id before retrying so a network blip cannot duplicate work.
    if (error.code === "GITHUB_PERMANENT_ERROR") throw error;
    if (await findRun()) dispatchAccepted = true;
    else if (attempt === 3) throw error;
  }
}

let runId;
for (let attempt = 0; attempt < 90 && !runId; attempt += 1) {
  const matching = await findRun();
  if (matching) runId = matching.databaseId;
  if (!runId) await sleep(2000);
}
if (!runId) throw new Error(`could not find dispatched ${workflow} run`);

const workspaceDir = args.get("workspace_dir");
const candidateId = args.get("candidate_id");
const logDirectory = workspaceDir && path.join(workspaceDir, "logs");
let progressStartedAt;
const readLocalLogLines = async () => {
  if (!logDirectory || !candidateId) return 0;
  try {
    const names = (await readdir(logDirectory))
      .filter(
        (name) =>
          name.startsWith(`${runId}-`) && name.endsWith(`-${candidateId}.log`),
      )
      .sort();
    if (!names.length) return 0;
    const contents = await readFile(
      path.join(logDirectory, names.at(-1)),
      "utf8",
    );
    return contents ? contents.split(/\r?\n/).filter(Boolean).length : 0;
  } catch {
    return 0;
  }
};
let lastLogLines = 0;
let completed = false;
let finalStatus;
const monitorDeadline = Date.now() + monitorTimeoutMs;
while (!completed) {
  if (Date.now() >= monitorDeadline)
    throw new Error(
      `${workflow} run ${runId} exceeded monitoring deadline of ${Math.ceil(monitorTimeoutMs / 60000)} minutes`,
    );
  let status;
  try {
    status = await getRunStatus(runId);
    if (!status)
      throw new Error(`run ${runId} is absent from GitHub status list`);
  } catch (error) {
    await writeStatus({ state: "status_query_failed", error: error.message });
    console.error(
      `[conductor] ${workflow} run=${runId} status query failed: ${error.message}`,
    );
    await sleep(Math.max(BUILD_POLL_INTERVAL_MS, 10000));
    continue;
  }

  lastLogLines = await readLocalLogLines();
  const state =
    status.status === "completed" ? status.conclusion : status.status;
  if (lastLogLines > 0 && !progressStartedAt) progressStartedAt = Date.now();
  const progress = estimateBuildProgress(
    lastLogLines,
    progressStartedAt,
    Date.now(),
  );
  await writeStatus({
    run_id: runId,
    state: state || "unknown",
    percent: progress.percent,
    eta: formatEta(progress.etaSeconds),
    log: `${progress.lines}/${progress.target}`,
  });

  finalStatus = status;
  completed = status.status === "completed";
  if (!completed) await sleep(BUILD_POLL_INTERVAL_MS);
}

if (finalStatus?.conclusion !== "success")
  throw new Error(
    `${workflow} run ${runId} finished with ${finalStatus?.conclusion || "unknown conclusion"}`,
  );
await writeStatus({
  run_id: runId,
  state: "success",
  conclusion: finalStatus.conclusion,
});

const output = await tempDir("gluster-workflow-result-");
try {
  await mkdir(output, { recursive: true });
  await runGh(
    ["run", "download", String(runId), "--name", artifact, "--dir", output],
    `${workflow} run ${runId} artifact download`,
  );
  const file = (
    await run(
      "find",
      [output, "-type", "f", "-name", "result.json", "-print", "-quit"],
      { capture: true },
    )
  ).stdout.trim();
  if (!file) throw new Error(`${workflow} did not provide result.json`);
  console.log(
    JSON.stringify({
      ...JSON.parse(await readFile(file, "utf8")),
      workflow,
      run_id: runId,
    }),
  );
} finally {
  await rm(output, { recursive: true, force: true });
}
