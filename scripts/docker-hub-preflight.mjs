import { env } from "./lib.mjs";
import {
  checkDockerHubRateLimit,
  DockerHubUnavailableError,
} from "./docker-hub-quota.mjs";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function checkDockerHubPreflight(references, log) {
  const attempts = Number(env("CONDUCTOR_DOCKERHUB_ATTEMPTS", "4"));
  const backoffMs = Number(env("CONDUCTOR_DOCKERHUB_BACKOFF_MS", "5000"));
  const minimumRemaining = Number(
    env("CONDUCTOR_DOCKERHUB_MIN_REMAINING", "24"),
  );

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await checkDockerHubRateLimit(references, globalThis.fetch, {
        minimumRemaining,
      });
    } catch (error) {
      if (!(error instanceof DockerHubUnavailableError) || attempt === attempts)
        throw error;
      const delay = Math.min(30000, attempt * backoffMs);
      log(
        "Docker Hub preflight retry",
        `attempt=${attempt + 1}/${attempts} wait=${Math.ceil(delay / 1000)}s`,
      );
      await sleep(delay);
    }
  }

  throw new Error("Docker Hub preflight retry loop ended unexpectedly");
}
