import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GITHUB_RATE_LIMIT_URL = "https://api.github.com/rate_limit";

export class GitHubRateLimitError extends Error {
  constructor(message, resetEpochSeconds, retryAfterSeconds = 60) {
    super(message);
    this.name = "GitHubRateLimitError";
    this.code = "GITHUB_RATE_LIMIT";
    this.resetEpochSeconds = resetEpochSeconds;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function header(response, name) {
  return (
    response.headers?.get?.(name) ||
    response.headers?.get?.(name.toLowerCase()) ||
    ""
  );
}

export async function checkGitHubRateLimit(
  fetchImpl = globalThis.fetch,
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "",
) {
  if (!token) {
    try {
      token = (
        await execFileAsync("gh", ["auth", "token"], { timeout: 5000 })
      ).stdout.trim();
    } catch {
      // Anonymous GitHub API access remains valid, but has a smaller quota.
    }
  }
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "eliware-glusterfs-conductor",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetchImpl(GITHUB_RATE_LIMIT_URL, { headers });
  const retryAfterHeader = Number.parseInt(header(response, "retry-after"), 10);
  const body = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 403 && response.status !== 429)
    throw new Error(
      `GitHub rate-limit endpoint returned HTTP ${response.status}`,
    );
  const core = body.resources?.core || {};
  const remaining = Number.isInteger(core.remaining)
    ? core.remaining
    : Number.parseInt(header(response, "x-ratelimit-remaining"), 10);
  const reset = Number.isInteger(core.reset)
    ? core.reset
    : Number.parseInt(header(response, "x-ratelimit-reset"), 10);
  if (response.status === 403 || response.status === 429 || remaining === 0) {
    const wait = Number.isInteger(retryAfterHeader)
      ? retryAfterHeader
      : Math.max(
          60,
          (Number.isInteger(reset) ? reset * 1000 - Date.now() : 60000) / 1000,
        );
    throw new GitHubRateLimitError(
      `GitHub API rate limit exhausted (${core.limit || header(response, "x-ratelimit-limit") || "unknown limit"}; ${remaining || 0} remaining)`,
      reset,
      Math.ceil(wait),
    );
  }
  return { checked: true, limit: core.limit, remaining, reset };
}
