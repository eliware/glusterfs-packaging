// Checkpoints sampled every ten seconds from successful workflow 31951732264.
// Build output is deliberately modeled by elapsed phase time, not line ratio.
export const BUILD_POLL_INTERVAL_MS = 10000;
export const BUILD_PROGRESS_CHECKPOINTS = [
  [4, 0],
  [14, 6],
  [129, 11],
  [238, 17],
  [494, 23],
  [899, 28],
  [1960, 34],
  [2212, 39],
  [2330, 45],
  [2638, 51],
  [2683, 56],
  [2735, 62],
  [2805, 67],
  [2864, 73],
  [2871, 78],
  [2897, 84],
  [2900, 90],
  [2932, 95],
  [2958, 101],
  [3008, 106],
  [3025, 112],
  [3055, 117],
  [3090, 123],
  [3112, 128],
  [3162, 134],
  [3184, 139],
  [3217, 145],
  [3233, 151],
  [3267, 156],
  [3292, 162],
  [3349, 167],
  [3393, 173],
  [3420, 178],
  [3444, 184],
  [3455, 190],
  [3503, 195],
  [3541, 201],
  [3639, 207],
  [3682, 212],
  [3733, 218],
  [3795, 224],
  [3825, 229],
  [3853, 235],
  [3932, 240],
  [4132, 246],
  [4295, 252],
  [4474, 257],
  [4504, 263],
  [4569, 268],
  [4708, 274],
  [4818, 280],
  [4959, 286],
  [5074, 291],
  [5188, 297],
  [5322, 302],
  [5410, 308],
  [5520, 314],
  [5700, 319],
  [5801, 325],
  [6127, 331],
  [6553, 336],
  [6834, 342],
  [8139, 348],
  [8174, 353],
  [8414, 359],
  [8417, 365],
  [8473, 370],
  [8473, 376],
  [8506, 381],
  [8533, 387],
];

function elapsedAt(lines, checkpoints) {
  if (lines <= checkpoints[0][0]) return checkpoints[0][1];
  for (let index = 1; index < checkpoints.length; index += 1) {
    const [rightLines, rightSeconds] = checkpoints[index];
    const [leftLines, leftSeconds] = checkpoints[index - 1];
    if (lines <= rightLines && rightLines > leftLines) {
      const fraction = (lines - leftLines) / (rightLines - leftLines);
      return leftSeconds + fraction * (rightSeconds - leftSeconds);
    }
  }
  return checkpoints.at(-1)[1];
}

export function estimateBuildProgress(
  logLines,
  startedAt,
  now = Date.now(),
  checkpoints = BUILD_PROGRESS_CHECKPOINTS,
) {
  const lines = Math.max(0, Number(logLines) || 0);
  const target = checkpoints.at(-1)[0];
  if (!startedAt || lines === 0) {
    return { percent: 0, etaSeconds: null, lines, target };
  }

  const expectedElapsed = elapsedAt(lines, checkpoints);
  const expectedTotal = checkpoints.at(-1)[1];
  const observedElapsed = Math.max(0, (now - startedAt) / 1000);
  const remaining = Math.max(0, expectedTotal - expectedElapsed);
  const speedFactor =
    expectedElapsed > 0 ? observedElapsed / expectedElapsed : 1;

  return {
    percent: Math.min(99, Math.floor((expectedElapsed / expectedTotal) * 100)),
    etaSeconds: Math.ceil(remaining * Math.max(1, speedFactor)),
    lines,
    target,
  };
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "pending";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}
