import { jest } from "@jest/globals";
import { checkGitHubRateLimit } from "../scripts/github-quota.mjs";

const response = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Map(Object.entries(headers)),
  json: async () => body,
});

test("reads the authenticated GitHub core quota", async () => {
  const fetchMock = jest.fn().mockResolvedValue(
    response(200, {
      resources: {
        core: { limit: 5000, remaining: 4999, reset: 2000000000 },
      },
    }),
  );
  await expect(
    checkGitHubRateLimit(fetchMock, "test-token"),
  ).resolves.toMatchObject({
    checked: true,
    remaining: 4999,
    reset: 2000000000,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.github.com/rate_limit",
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
    }),
  );
});

test("defers when GitHub core quota is exhausted", async () => {
  const fetchMock = jest.fn().mockResolvedValue(
    response(403, {
      resources: { core: { limit: 60, remaining: 0, reset: 2000000000 } },
    }),
  );
  await expect(checkGitHubRateLimit(fetchMock)).rejects.toMatchObject({
    code: "GITHUB_RATE_LIMIT",
    resetEpochSeconds: 2000000000,
  });
});
