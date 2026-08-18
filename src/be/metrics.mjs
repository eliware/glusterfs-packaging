const state = {
  requests: 0,
  active: 0,
  bytes: 0,
  durationMs: 0,
  status: new Map(),
  paths: new Map(),
};

export function startRequest() {
  state.active += 1;
}

export function recordRequest({ method, path, status, durationMs, bytes }) {
  state.requests += 1;
  state.active = Math.max(0, state.active - 1);
  state.bytes += Number(bytes) || 0;
  state.durationMs += Number(durationMs) || 0;
  const statusKey = String(status || 0);
  state.status.set(statusKey, (state.status.get(statusKey) || 0) + 1);
  const pathKey = `${method || "-"} ${path || "/"}`;
  state.paths.set(pathKey, (state.paths.get(pathKey) || 0) + 1);
}

function labels(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key}="${String(value).replaceAll('"', '\\"')}"`)
    .join(",");
}

export function renderMetrics() {
  const lines = [
    "# HELP gluster_repository_http_requests_total Total HTTP requests.",
    "# TYPE gluster_repository_http_requests_total counter",
    `gluster_repository_http_requests_total ${state.requests}`,
    "# HELP gluster_repository_http_active_requests Current active HTTP requests.",
    "# TYPE gluster_repository_http_active_requests gauge",
    `gluster_repository_http_active_requests ${state.active}`,
    "# HELP gluster_repository_http_response_bytes_total Total response bytes.",
    "# TYPE gluster_repository_http_response_bytes_total counter",
    `gluster_repository_http_response_bytes_total ${state.bytes}`,
    "# HELP gluster_repository_http_request_duration_ms_total Cumulative request duration in milliseconds.",
    "# TYPE gluster_repository_http_request_duration_ms_total counter",
    `gluster_repository_http_request_duration_ms_total ${state.durationMs}`,
  ];
  for (const [status, count] of state.status)
    lines.push(
      `gluster_repository_http_requests_by_status_total{${labels({ status })}} ${count}`,
    );
  for (const [request, count] of state.paths) {
    const [method, ...pathParts] = request.split(" ");
    lines.push(
      `gluster_repository_http_requests_by_path_total{${labels({ method, path: pathParts.join(" ") })}} ${count}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
