import {
  dockerHubBasicAuthorization,
  readDockerHubCredentials,
} from "./docker-hub-auth.mjs";

const DOCKER_AUTH_URL =
  "https://auth.docker.io/token?service=registry.docker.io&scope=repository:ratelimitpreview/test:pull";
const DOCKER_MANIFEST_URL =
  "https://registry-1.docker.io/v2/ratelimitpreview/test/manifests/latest";

export class DockerHubRateLimitError extends Error {
  constructor(message, retryAfterSeconds = 3600) {
    super(message);
    this.name = "DockerHubRateLimitError";
    this.code = "DOCKER_HUB_RATE_LIMIT";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class DockerHubUnavailableError extends Error {
  constructor(message, retryAfterSeconds = 30) {
    super(message);
    this.name = "DockerHubUnavailableError";
    this.code = "DOCKER_HUB_UNAVAILABLE";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isDockerHubReference(reference) {
  const value = String(reference).split("@")[0].split(":")[0];
  return (
    !value.includes("/") ||
    value.startsWith("docker.io/") ||
    value.startsWith("index.docker.io/")
  );
}

function header(response, name) {
  return (
    response.headers?.get?.(name) ||
    response.headers?.get?.(name.toLowerCase()) ||
    ""
  );
}

function windowSeconds(value) {
  const match = /;w=(\d+)/i.exec(value);
  return match ? Number(match[1]) : 3600;
}

function quotaNumber(value) {
  const match = /^\s*(\d+)/.exec(String(value || ""));
  return match ? Number(match[1]) : null;
}

export async function checkDockerHubRateLimit(
  references,
  fetchImpl = globalThis.fetch,
  { credentials = null, minimumRemaining = 24 } = {},
) {
  if (
    !references.some(
      (reference) =>
        isDockerHubReference(reference) &&
        !/@sha256:[0-9a-f]{64}$/i.test(String(reference)),
    )
  )
    return { checked: false };
  credentials ||= await readDockerHubCredentials();
  if (!credentials)
    throw new Error(
      "Docker Hub authentication is required; run docker login or set DOCKERHUB_USERNAME and DOCKERHUB_TOKEN",
    );
  let tokenResponse;
  try {
    tokenResponse = await fetchImpl(DOCKER_AUTH_URL, {
      headers: { Authorization: dockerHubBasicAuthorization(credentials) },
    });
  } catch (error) {
    throw new DockerHubUnavailableError(
      `Docker Hub token request failed: ${error.message}`,
    );
  }
  if (!tokenResponse.ok)
    throw new DockerHubUnavailableError(
      `Docker Hub quota token request returned HTTP ${tokenResponse.status}`,
      tokenResponse.status >= 500 ? 30 : 3600,
    );
  const token = (await tokenResponse.json()).token;
  let response;
  try {
    response = await fetchImpl(DOCKER_MANIFEST_URL, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new DockerHubUnavailableError(
      `Docker Hub quota request failed: ${error.message}`,
    );
  }
  if (response.status === 429)
    throw new DockerHubRateLimitError(
      "Docker Hub rate limit exhausted",
      quotaNumber(header(response, "retry-after")) || 3600,
    );
  if (!response.ok)
    throw new DockerHubUnavailableError(
      `Docker Hub quota request returned HTTP ${response.status}`,
      response.status >= 500 ? 30 : 3600,
    );
  const limitHeader = header(response, "ratelimit-limit");
  const remainingHeader = header(response, "ratelimit-remaining");
  const limit = quotaNumber(limitHeader);
  const remaining = quotaNumber(remainingHeader);
  const retryAfter = quotaNumber(header(response, "retry-after"));
  if (limit === null || remaining === null)
    throw new DockerHubUnavailableError(
      "Docker Hub quota response omitted rate-limit headers",
    );
  if (remaining <= 0 || remaining < minimumRemaining) {
    const wait = Number.isInteger(retryAfter)
      ? retryAfter
      : windowSeconds(limitHeader);
    throw new DockerHubRateLimitError(
      `Docker Hub quota too low (${limit}; ${remaining} remaining; minimum ${minimumRemaining})`,
      wait,
    );
  }
  return {
    checked: true,
    limit,
    remaining,
    windowSeconds: windowSeconds(limitHeader),
  };
}
