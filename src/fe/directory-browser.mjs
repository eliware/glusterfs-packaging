import { fetchDirectory } from "./api.mjs";
import { getElement } from "./dom.mjs";
import { formatBytes, formatDateTime } from "./format.mjs";

const distributionLabels = {
  "centos-stream-10": "CentOS Stream 10",
  "rocky-10": "Rocky Linux 10",
  "almalinux-10": "AlmaLinux 10",
  "oracle-linux-10": "Oracle Linux 10",
  "debian-bookworm": "Debian 12 (bookworm)",
  "ubuntu-noble": "Ubuntu 24.04 (noble)",
};

let currentListing;
let sortKey = "type";
let ascending = true;
let filterQuery = "";
let runtimeOnly = false;

function validationIcon(status) {
  const icon = status === "passed" ? "✓" : status === "failed" ? "✕" : "—";
  return `<span class="validation-icon ${status || "skip"}">${icon}</span>`;
}

function metadataStatus(result) {
  return typeof result === "string" ? result : result?.status;
}

function renderValidation(listing) {
  const section = getElement("directory-validation");
  const body = getElement("directory-validation-rows");
  if (!section || !body) return;
  const rpm = listing.validation;
  const container = listing.container_validation;
  const distributions = [
    ...(rpm?.distributions || []),
    ...(container?.distributions || []),
  ].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.id === item.id) === index,
  );
  if (!distributions.length) return;
  body.innerHTML = distributions
    .map((item) => {
      const rpmResult = rpm?.distributions?.find(
        (candidate) => candidate.id === item.id,
      );
      const containerResult = container?.distributions?.find(
        (candidate) => candidate.id === item.id,
      );
      const packageResult = rpmResult?.package_core || rpmResult?.core;
      const label = distributionLabels[item.id] || item.label || item.id;
      const repositoryResult =
        rpmResult?.repository_integrity ||
        rpmResult?.integrity ||
        containerResult?.repository_integrity;
      const provenanceResult =
        rpmResult?.provenance ||
        rpmResult?.provenance_verification ||
        containerResult?.provenance;
      return `<tr><th scope="row">${label}</th><td>${validationIcon(packageResult?.status)}</td><td>${validationIcon((containerResult?.container_core || containerResult?.core)?.status)}</td><td>${validationIcon(metadataStatus(repositoryResult))}</td><td>${validationIcon(metadataStatus(provenanceResult))}</td></tr>`;
    })
    .join("");
  section.hidden = false;
}

function parentPath(path) {
  return path.split("/").slice(0, -2).join("/") || "/";
}

function renderBreadcrumbs(path) {
  const breadcrumbs = getElement("directory-breadcrumbs");
  breadcrumbs.replaceChildren();
  const root = document.createElement("a");
  root.href = "/";
  root.textContent = "glusterfs.eliware.org";
  breadcrumbs.appendChild(root);
  const parts = path.split("/").filter(Boolean);
  let href = "/";
  parts.forEach((part, index) => {
    const separator = document.createElement("span");
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "/";
    breadcrumbs.appendChild(separator);
    href += `${encodeURIComponent(part)}/`;
    const crumb = document.createElement(
      index === parts.length - 1 ? "span" : "a",
    );
    if (crumb instanceof HTMLAnchorElement) crumb.href = href;
    crumb.textContent = decodeURIComponent(part);
    if (index === parts.length - 1) crumb.setAttribute("aria-current", "page");
    breadcrumbs.appendChild(crumb);
  });
}

function formatModified(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const absolute = formatDateTime(date);
  const elapsedSeconds = (Date.now() - date.getTime()) / 1000;
  const absoluteElapsed = Math.abs(elapsedSeconds);
  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const [unit, divisor] =
    units.find(([, seconds]) => absoluteElapsed >= seconds) || units.at(-1);
  const relativeValue = Math.round(-elapsedSeconds / divisor);
  const relative = new Intl.RelativeTimeFormat(undefined, {
    numeric: "always",
  }).format(relativeValue, unit);
  return { absolute, relative, iso: date.toISOString() };
}

function addEntryRow(table, entry) {
  const row = document.createElement("tr");
  const icon = document.createElement("td");
  const name = document.createElement("td");
  const size = document.createElement("td");
  const modified = document.createElement("td");
  name.className = "name";
  modified.className = "modified-cell";
  icon.className = "kind";
  icon.setAttribute("aria-hidden", "true");
  const iconSymbol = document.createElement("span");
  iconSymbol.className = "kind-symbol glyph";
  iconSymbol.textContent = entry.type === "directory" ? "▰" : "▤";
  icon.appendChild(iconSymbol);
  const link = document.createElement("a");
  link.href = entry.href;
  link.textContent = `${entry.name}${entry.type === "directory" ? "/" : ""}`;
  name.appendChild(link);
  size.textContent = entry.size == null ? "Directory" : formatBytes(entry.size);
  const modifiedDate = formatModified(entry.modified);
  if (modifiedDate) {
    const absolute = document.createElement("time");
    absolute.className = "modified-absolute";
    absolute.dateTime = modifiedDate.iso;
    absolute.textContent = modifiedDate.absolute;
    const relative = document.createElement("span");
    relative.className = "modified-relative";
    relative.textContent = modifiedDate.relative;
    modified.append(absolute, relative);
  } else modified.textContent = "—";
  row.append(icon, name, size, modified);
  table.appendChild(row);
}

function compareEntries(left, right) {
  if (sortKey === "type") {
    const leftType = left.type === "directory" ? 0 : 1;
    const rightType = right.type === "directory" ? 0 : 1;
    if (leftType !== rightType) return leftType - rightType;
  } else if (sortKey === "size") {
    const leftSize = left.size ?? -1;
    const rightSize = right.size ?? -1;
    if (leftSize !== rightSize) return leftSize - rightSize;
  } else if (sortKey === "date") {
    const leftDate = left.modified ? Date.parse(left.modified) : 0;
    const rightDate = right.modified ? Date.parse(right.modified) : 0;
    if (leftDate !== rightDate) return leftDate - rightDate;
  }
  return left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
  });
}

function renderEntries() {
  const entries = getElement("directory-entries");
  entries.replaceChildren();
  if (currentListing.path !== "/") {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="kind" aria-hidden="true"><span class="kind-symbol glyph">↥</span></td><td><a href="${encodeURI(parentPath(currentListing.path))}">Parent directory</a></td><td>—</td><td>—</td>`;
    entries.appendChild(row);
  }
  const filtered = currentListing.entries.filter((entry) => {
    const matchesQuery = entry.name.toLowerCase().includes(filterQuery);
    const hiddenArtifact = /-debuginfo|-devel|\.src\.rpm/i.test(entry.name);
    return matchesQuery && (!runtimeOnly || !hiddenArtifact);
  });
  const sorted = [...filtered].sort((left, right) => {
    const result = compareEntries(left, right);
    return ascending ? result : -result;
  });
  sorted.forEach((entry) => addEntryRow(entries, entry));
  const files = filtered.filter((entry) => entry.type === "file");
  const totalSize = files.reduce(
    (total, entry) => total + (entry.size || 0),
    0,
  );
  const summary = getElement("directory-summary");
  if (summary)
    summary.textContent = `Showing ${filtered.length} of ${currentListing.entries.length} entries · ${files.length} files · ${formatBytes(totalSize)}`;
}

function updateSortButton() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    const selected = button.dataset.sortKey === sortKey;
    const header = button.closest("th");
    button.classList.toggle("active", selected);
    if (header)
      header.setAttribute(
        "aria-sort",
        selected ? (ascending ? "ascending" : "descending") : "none",
      );
    const arrow = button.querySelector("span");
    if (arrow) arrow.textContent = selected ? (ascending ? "↑" : "↓") : "↕";
  });
  const filter = getElement("directory-filter");
  if (filter)
    filter.addEventListener("input", () => {
      filterQuery = filter.value.trim().toLowerCase();
      renderEntries();
    });
  const view = getElement("directory-view");
  if (view)
    view.addEventListener("change", () => {
      runtimeOnly = view.value === "runtime";
      renderEntries();
    });
}

export async function initDirectoryBrowser() {
  const entries = getElement("directory-entries");
  if (!entries || !getElement("directory-title")) return;
  const currentPath = location.pathname.endsWith("/")
    ? location.pathname
    : `${location.pathname}/`;
  currentListing = await fetchDirectory(currentPath);
  renderValidation(currentListing);
  getElement("directory-title").textContent = `Index of ${currentListing.path}`;
  const pathElement = getElement("directory-path");
  if (pathElement) pathElement.textContent = currentListing.path;
  if (getElement("directory-breadcrumbs"))
    renderBreadcrumbs(currentListing.path);
  getElement("directory-status").textContent =
    `${currentListing.entries.length} entries`;
  document.querySelectorAll(".sort-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (sortKey === button.dataset.sortKey) ascending = !ascending;
      else {
        sortKey = button.dataset.sortKey;
        ascending = true;
      }
      updateSortButton();
      renderEntries();
    });
  });
  updateSortButton();
  renderEntries();
}
