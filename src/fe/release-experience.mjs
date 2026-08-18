import {
  fetchCatalog,
  fetchReleaseManifest,
  fetchRepositoryIndex,
  origin,
} from "./api.mjs";
import { getElement } from "./dom.mjs";
import { formatBytes, formatDateTime, previewCommit } from "./format.mjs";

const state = {
  catalog: {},
  index: { directories: {} },
  manifest: null,
  packages: [],
  query: "",
  format: "all",
  channel: "all",
  selected: null,
};

function allPackages(index) {
  return Object.values(index.directories || {}).flatMap((directory) =>
    (directory.entries || [])
      .filter((entry) => entry.type === "file" && entry.package)
      .map((entry) => ({ ...entry, directory: directory.path })),
  );
}

function releaseFor(entry) {
  const parts = entry.href.split("/").filter(Boolean);
  const previewIndex = parts.indexOf("previews");
  if (previewIndex >= 0)
    return {
      channel: "rolling",
      version: parts[previewIndex + 1] || "rolling",
    };
  const versionIndex = parts.findIndex((part) => /^\d+\.\d+$/.test(part));
  return {
    channel: "stable",
    version: versionIndex >= 0 ? parts[versionIndex] : "stable",
  };
}

function packageMatches(entry) {
  const release = releaseFor(entry);
  const needle = state.query.trim().toLowerCase();
  return (
    (!needle || entry.name.toLowerCase().includes(needle)) &&
    (state.format === "all" || entry.package.format === state.format) &&
    (state.channel === "all" || release.channel === state.channel)
  );
}

function packageCount(version, channel) {
  return state.packages.filter((entry) => {
    const release = releaseFor(entry);
    return release.version === version && release.channel === channel;
  }).length;
}

function renderDetail(entry) {
  const panel = getElement("package-detail-panel");
  if (!panel || !entry) return;
  const release = releaseFor(entry);
  const filename = entry.name;
  const url = `${origin}${entry.href}`;
  const checksum = `${entry.sha256 || "unavailable"}  ${filename}`;
  getElement("package-detail-title").textContent = filename;
  getElement("package-detail-meta").textContent =
    `${entry.package.format.toUpperCase()} · ${release.channel} · ${release.version} · ${formatBytes(entry.size || 0)} · ${formatDateTime(entry.modified)}`;
  getElement("package-detail-hash").textContent =
    entry.sha256 || "Checksum unavailable";
  getElement("package-detail-link").href = entry.href;
  getElement("package-detail-command").textContent =
    entry.package.format === "rpm"
      ? `curl -fsSLO ${url}\necho "${checksum}" | sha256sum --check -\nsudo dnf install -y ./${filename}`
      : `curl -fsSLO ${url}\necho "${checksum}" | sha256sum --check -\nsudo apt install ./${filename}`;
  panel.hidden = false;
  state.selected = entry;
}

function renderSearch() {
  const list = getElement("package-search-results");
  const status = getElement("package-search-status");
  if (!list || !status) return;
  const matches = state.packages.filter(packageMatches);
  list.replaceChildren();
  status.textContent = `${matches.length} matching package${matches.length === 1 ? "" : "s"}`;
  matches.slice(0, 12).forEach((entry) => {
    const item = document.createElement("article");
    item.className = "package-result";
    const link = document.createElement("button");
    link.type = "button";
    link.className = "package-result-button";
    const release = releaseFor(entry);
    link.innerHTML = `<strong>${entry.name}</strong><span>${entry.package.format.toUpperCase()} · ${release.channel} · ${formatBytes(entry.size || 0)}</span>`;
    link.addEventListener("click", () => renderDetail(entry));
    item.appendChild(link);
    list.appendChild(item);
  });
  if (matches.length > 12) {
    const more = document.createElement("p");
    more.className = "muted small";
    more.textContent = `Showing the first 12 results. Refine your search to see more.`;
    list.appendChild(more);
  }
}

function renderTimeline() {
  const timeline = getElement("release-timeline");
  if (!timeline) return;
  const stable = state.catalog.stable;
  const preview = state.catalog.preview;
  const events = [];
  if (stable?.version)
    events.push({
      label: `Stable ${stable.version}`,
      detail: stable.built || stable.generated,
      status: "Published",
    });
  (preview?.items || []).slice(0, 5).forEach((item) =>
    events.push({
      label: `Rolling ${item.candidate || previewCommit(item)}`,
      detail: item.built || item.generated,
      status: item.validation ? "Validated" : "Published",
    }),
  );
  if (state.manifest?.generated)
    events.push({
      label: "Repository manifest",
      detail: state.manifest.generated,
      status: "Signed metadata",
    });
  timeline.replaceChildren();
  if (!events.length) {
    timeline.textContent =
      "Release lifecycle data will appear after the first validated publication.";
    return;
  }
  events.forEach((event) => {
    const item = document.createElement("li");
    item.innerHTML = `<span class="timeline-dot" aria-hidden="true"></span><div><strong>${event.label}</strong><span>${event.status} · ${formatDateTime(event.detail)}</span></div>`;
    timeline.appendChild(item);
  });
}

function releaseOptions() {
  const options = [];
  if (state.catalog.stable?.version)
    options.push({
      id: `stable:${state.catalog.stable.version}`,
      label: `Stable ${state.catalog.stable.version}`,
      version: state.catalog.stable.version,
      channel: "stable",
    });
  (state.catalog.preview?.items || []).forEach((item) =>
    options.push({
      id: `rolling:${item.candidate}`,
      label: `Rolling ${item.candidate}`,
      version: item.candidate,
      channel: "rolling",
    }),
  );
  return options;
}

function renderComparison() {
  const result = getElement("release-comparison-result");
  const left = getElement("compare-from")?.value;
  const right = getElement("compare-to")?.value;
  if (!result || !left || !right) return;
  const options = releaseOptions();
  const from = options.find((item) => item.id === left);
  const to = options.find((item) => item.id === right);
  if (!from || !to) return;
  result.innerHTML = `<div><span>Packages</span><strong>${packageCount(from.version, from.channel)} → ${packageCount(to.version, to.channel)}</strong></div><div><span>Channel</span><strong>${from.channel} → ${to.channel}</strong></div><div><span>Release</span><strong>${from.label} → ${to.label}</strong></div>`;
}

function populateComparison() {
  const from = getElement("compare-from");
  const to = getElement("compare-to");
  if (!from || !to) return;
  const options = releaseOptions();
  [from, to].forEach((select, index) => {
    select.replaceChildren();
    options.forEach((option) => {
      const item = document.createElement("option");
      item.value = option.id;
      item.textContent = option.label;
      select.appendChild(item);
    });
    if (options[index]) select.value = options[index].id;
    select.addEventListener("change", renderComparison);
  });
  renderComparison();
}

function initControls() {
  const search = getElement("package-search");
  search?.addEventListener("input", () => {
    state.query = search.value;
    renderSearch();
  });
  getElement("package-format")?.addEventListener("change", (event) => {
    state.format = event.target.value;
    renderSearch();
  });
  getElement("package-channel")?.addEventListener("change", (event) => {
    state.channel = event.target.value;
    renderSearch();
  });
  document.querySelectorAll("[data-package-detail-copy]").forEach((button) =>
    button.addEventListener("click", async () => {
      const target = getElement(button.dataset.packageDetailCopy);
      if (!target) return;
      await navigator.clipboard.writeText(target.textContent);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 2500);
    }),
  );
}

export async function initReleaseExperience() {
  if (!getElement("package-search") && !getElement("package-detail-panel"))
    return;
  try {
    [state.catalog, state.index, state.manifest] = await Promise.all([
      fetchCatalog(),
      fetchRepositoryIndex(),
      fetchReleaseManifest().catch(() => null),
    ]);
    state.packages = allPackages(state.index);
    initControls();
    renderSearch();
    renderTimeline();
    populateComparison();
    const requested = new URLSearchParams(location.search).get("package");
    if (requested)
      renderDetail(state.packages.find((entry) => entry.href === requested));
  } catch {
    const status = getElement("package-search-status");
    if (status)
      status.textContent = "Package metadata is temporarily unavailable.";
  }
}
