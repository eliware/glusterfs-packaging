import {
  checkDockerHubRateLimit,
  isDockerHubReference,
} from "../scripts/docker-hub-quota.mjs";
import { jest } from "@jest/globals";

const response = (status, headers, body = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Map(Object.entries(headers)),
  json: async () => body,
});

test("recognizes Docker Hub shorthand references", () => {
  expect(isDockerHubReference("almalinux:10")).toBe(true);
  expect(isDockerHubReference("quay.io/almalinux:10")).toBe(false);
});

test("defers when Docker Hub reports no remaining quota", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce(response(200, {}, { token: "test-token" }))
    .mockResolvedValueOnce(
      response(429, {
        "ratelimit-limit": "100;w=3600",
        "ratelimit-remaining": "0;w=3600",
      }),
    );
  await expect(
    checkDockerHubRateLimit(["almalinux:10"], fetchMock, {
      credentials: { username: "test-user", password: "test-token" },
    }),
  ).rejects.toMatchObject({
    code: "DOCKER_HUB_RATE_LIMIT",
    retryAfterSeconds: 3600,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("returns quota when Docker Hub has capacity", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce(response(200, {}, { token: "test-token" }))
    .mockResolvedValueOnce(
      response(200, {
        "ratelimit-limit": "100;w=3600",
        "ratelimit-remaining": "42;w=3600",
      }),
    );
  await expect(
    checkDockerHubRateLimit(["almalinux:10"], fetchMock, {
      credentials: { username: "test-user", password: "test-token" },
    }),
  ).resolves.toMatchObject({
    checked: true,
    remaining: 42,
  });
});
