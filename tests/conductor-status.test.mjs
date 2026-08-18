import {
  compareStatusReports,
  createStatusDocument,
  filterDisplayedStatusReports,
  formatStatusLine,
  formatStatusProgress,
} from "../scripts/conductor-status.mjs";

test("sorts status reports deterministically", () => {
  expect(
    [{ sort_key: "z" }, { sort_key: "a" }, { sort_key: "m" }].sort(
      compareStatusReports,
    ),
  ).toEqual([{ sort_key: "a" }, { sort_key: "m" }, { sort_key: "z" }]);
});

test("status reports omit successful lanes but retain queued, active, and failed lanes", () => {
  expect(
    filterDisplayedStatusReports([
      { label: "done", state: "success" },
      { label: "waiting", state: "queued" },
      { label: "running", state: "in_progress" },
      { label: "failed", state: "failure" },
    ]),
  ).toEqual([
    { label: "waiting", state: "queued" },
    { label: "running", state: "in_progress" },
    { label: "failed", state: "failure" },
  ]);
});

test("formats build status progress and complete status lines", () => {
  const report = {
    state: "in_progress",
    stage: "package-build",
    percent: 42,
    eta: "3m",
    log: "120/8533",
    run_id: "run-1",
    label: "epel10-stable",
  };
  expect(formatStatusProgress(report)).toBe("42% eta=3m log=120/8533");
  expect(formatStatusLine(report)).toBe(
    "in_progress stage=package-build 42% eta=3m log=120/8533 run=run-1 lane=epel10-stable",
  );
  expect(formatStatusProgress({ image_log: "12/40" })).toBe("image-log=12/40");
});

test("creates a normalized local status document", () => {
  expect(
    createStatusDocument({
      label: "lane",
      stage: "smoke-2",
      runId: "run-1",
      updated: "now",
      status: { state: "queued", percent: 0 },
    }),
  ).toEqual({
    label: "lane",
    sort_key: "lane:smoke-2",
    stage: "smoke-2",
    run_id: "run-1",
    updated: "now",
    state: "queued",
    percent: 0,
  });
});
