export function compareStatusReports(left, right) {
  return String(left.sort_key || left.label || "").localeCompare(
    String(right.sort_key || right.label || ""),
  );
}

export function filterDisplayedStatusReports(reports) {
  return reports.filter((report) =>
    ["queued", "in_progress", "failure"].includes(report.state),
  );
}

export function formatStatusProgress(report) {
  if (report.image_log !== undefined) return `image-log=${report.image_log}`;
  return `${report.percent ?? 0}% eta=${report.eta || "pending"} log=${report.log || "0/0"}`;
}

export function formatStatusLine(report) {
  return `${report.state || "unknown"} stage=${report.stage || "github"} ${formatStatusProgress(report)} run=${report.run_id || "pending"} lane=${report.label || "unknown"}`;
}

export function createStatusDocument({ label, stage, runId, updated, status }) {
  return {
    label,
    sort_key: `${label}:${stage}`,
    stage,
    run_id: runId,
    updated,
    ...status,
  };
}
