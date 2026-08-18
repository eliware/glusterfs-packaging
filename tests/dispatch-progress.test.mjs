import {
  BUILD_PROGRESS_CHECKPOINTS,
  estimateBuildProgress,
  formatEta,
} from "../scripts/progress-estimate.mjs";

test("estimates progress from non-linear build checkpoints", () => {
  const result = estimateBuildProgress(1960, 1_000, 35_000);
  expect(result.percent).toBe(8);
  expect(result.etaSeconds).toBe(353);
  expect(result.target).toBe(BUILD_PROGRESS_CHECKPOINTS.at(-1)[0]);
});

test("formats compact ETAs", () => {
  expect(formatEta(12)).toBe("12s");
  expect(formatEta(125)).toBe("2m05s");
});
