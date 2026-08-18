import { buildLanes, imageTargetsForLane } from "../scripts/lane-config.mjs";

const lanes = buildLanes({
  stableTag: "v11.2",
  sourceCommit: "stable-source-commit",
  rollingCommit: "rolling-source-commit",
  date: "2026.08.18",
});

test("defines all six stable and rolling package lanes", () => {
  expect(lanes.map((lane) => lane.id)).toEqual([
    "epel10-stable",
    "debian-stable",
    "ubuntu-stable",
    "epel10-rolling",
    "debian-rolling",
    "ubuntu-rolling",
  ]);
  expect(lanes.filter((lane) => lane.channel === "stable")).toHaveLength(3);
  expect(lanes.filter((lane) => lane.channel === "preview")).toHaveLength(3);
});

test.each([
  ["epel10-stable", ["centos-stream", "rocky", "alma", "oracle"]],
  ["epel10-rolling", ["centos-stream", "rocky", "alma", "oracle"]],
  ["debian-stable", ["debian"]],
  ["debian-rolling", ["debian"]],
  ["ubuntu-stable", ["ubuntu"]],
  ["ubuntu-rolling", ["ubuntu"]],
])("maps %s to its supported image targets", (laneId, distributions) => {
  const lane = lanes.find((entry) => entry.id === laneId);
  expect(
    imageTargetsForLane(lane).map(([distribution]) => distribution),
  ).toEqual(distributions);
});
