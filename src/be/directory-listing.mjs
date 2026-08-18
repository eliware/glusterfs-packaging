import path from "node:path";
import { promises as fs } from "node:fs";
import { baseHeaders, compressBody } from "./response.mjs";
import { servingHostId } from "./runtime-identity.mjs";
import { APP_VERSION } from "./app-version.mjs";

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "B";
  for (const nextUnit of units) {
    value /= 1024;
    unit = nextUnit;
    if (value < 1024) break;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

const distributionLabels = {
  "centos-stream-10": "CentOS Stream 10",
  "rocky-10": "Rocky Linux 10",
  "almalinux-10": "AlmaLinux 10",
  "oracle-linux-10": "Oracle Linux 10",
  "debian-bookworm": "Debian 12 (bookworm)",
  "ubuntu-noble": "Ubuntu 24.04 (noble)",
};

function copyrightYear() {
  const year = new Date().getUTCFullYear();
  return year <= 2026 ? "2026" : `2026-${year}`;
}

function ogImageForPath(requestPath) {
  const match = requestPath.match(/^\/metadata\/runs\/([^/]+)/);
  return match
    ? `/metadata/runs/${encodeURIComponent(match[1])}/release-card.png`
    : "/metadata/latest-release-card.png";
}

function renderBreadcrumbs(requestPath) {
  const parts = requestPath.split("/").filter(Boolean);
  const crumbs = ['<a href="/">glusterfs.eliware.org</a>'];
  let href = "/";
  for (const [index, part] of parts.entries()) {
    const decoded = decodeURIComponent(part);
    href += `${encodeURIComponent(decoded)}/`;
    const label = escapeHtml(decoded);
    const final = index === parts.length - 1;
    crumbs.push(
      `<span aria-hidden="true">/</span>${final ? `<span aria-current="page">${label}</span>` : `<a href="${escapeHtml(href)}">${label}</a>`}`,
    );
  }
  return crumbs.join(" ");
}

function validationIcon(status) {
  if (status === "passed") return '<span class="validation-pass">✓</span>';
  if (status === "failed") return '<span class="validation-fail">✕</span>';
  return '<span class="validation-skip">—</span>';
}

function metadataStatus(result) {
  return typeof result === "string" ? result : result?.status;
}

function renderValidation(validation, containerValidation) {
  const distributions = [
    ...(validation?.distributions || []),
    ...(containerValidation?.distributions || []),
  ].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.id === item.id) === index,
  );
  if (!distributions.length) return "";
  const rows = distributions
    .map((item) => {
      const rpm = validation?.distributions?.find(
        (candidate) => candidate.id === item.id,
      );
      const container = containerValidation?.distributions?.find(
        (candidate) => candidate.id === item.id,
      );
      const packageResult = rpm?.package_core || rpm?.core;
      const label = distributionLabels[item.id] || item.label || item.id;
      const repositoryResult =
        rpm?.repository_integrity ||
        rpm?.integrity ||
        container?.repository_integrity;
      const provenanceResult =
        rpm?.provenance ||
        rpm?.provenance_verification ||
        container?.provenance;
      return `<tr><th scope="row">${escapeHtml(label)}</th><td>${validationIcon(packageResult?.status)}</td><td>${validationIcon((container?.container_core || container?.core)?.status)}</td><td>${validationIcon(metadataStatus(repositoryResult))}</td><td>${validationIcon(metadataStatus(provenanceResult))}</td></tr>`;
    })
    .join("");
  return `<section class="validation-summary" aria-labelledby="validation-title"><div><p class="eyebrow">Build verification</p><h2 id="validation-title">Compatibility checks</h2><p>Package, container, repository integrity, and provenance validation for this package set.</p></div><table><thead><tr><th>Distribution</th><th>Package core</th><th>Container core</th><th>Repository integrity</th><th>Provenance</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

export async function sendDirectoryListing(
  response,
  request,
  directoryPath,
  requestPath,
  config,
) {
  const entries = (await fs.readdir(directoryPath, { withFileTypes: true }))
    .filter((entry) => config.allowDotfiles || !entry.name.startsWith("."))
    .sort(
      (left, right) =>
        Number(right.isDirectory()) - Number(left.isDirectory()) ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
  const rows = [];
  let fileCount = 0;
  let totalBytes = 0;
  if (requestPath !== "/") {
    const parent = path.posix.dirname(requestPath.replace(/\/$/, "")) || "/";
    rows.push(
      `<tr><td class="kind" aria-hidden="true"><span class="kind-symbol">↥</span></td><td class="name"><a href="${escapeHtml(parent)}">Parent directory</a></td><td>—</td><td>—</td></tr>`,
    );
  }
  for (const entry of entries) {
    const entryPath =
      requestPath +
      encodeURIComponent(entry.name) +
      (entry.isDirectory() ? "/" : "");
    let size = "—";
    let modified = "—";
    let modifiedIso = "";
    try {
      const stats = await fs.stat(path.join(directoryPath, entry.name));
      size = entry.isDirectory() ? "Directory" : formatBytes(stats.size);
      if (entry.isFile()) {
        fileCount += 1;
        totalBytes += stats.size;
      }
      modifiedIso = stats.mtime.toISOString();
      modified = stats.mtime
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC");
    } catch {
      /* entry may disappear during listing */
    }
    const modifiedAttribute = entry.isFile()
      ? ` data-modified="${modifiedIso}"`
      : "";
    rows.push(
      `<tr data-name="${escapeHtml(entry.name.toLowerCase())}"><td class="kind" aria-hidden="true"><span class="kind-symbol">${entry.isDirectory() ? "▰" : "▤"}</span></td><td class="name"><a href="${escapeHtml(entryPath)}">${escapeHtml(entry.name)}${entry.isDirectory() ? "/" : ""}</a></td><td>${size}</td><td class="modified-cell"${modifiedAttribute}>${modified}</td></tr>`,
    );
  }
  const title = `Index of ${requestPath}`;
  const ogImage = ogImageForPath(requestPath);
  const ogDescription = `Browse signed Eliware GlusterFS artifacts in ${title}.`;
  let validation = null;
  let containerValidation = null;
  try {
    validation = JSON.parse(
      await fs.readFile(path.join(directoryPath, "validation.json"), "utf8"),
    );
  } catch {}
  try {
    containerValidation = JSON.parse(
      await fs.readFile(
        path.join(directoryPath, "container-validation.json"),
        "utf8",
      ),
    );
  } catch {}
  const fallback = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{color-scheme:dark}body{margin:0;background:#080d18;color:#e8eef8;font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:4rem auto;padding:0 1.25rem}h1{font-size:clamp(1.5rem,4vw,2.5rem);word-break:break-all}table{width:100%;border-collapse:collapse;background:#101b2e;border:1px solid #243553;border-radius:12px;overflow:hidden}th,td{text-align:left;padding:.8rem 1rem;border-bottom:1px solid #243553}th{color:#9fb0c7;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em}tr:last-child td{border-bottom:0}tr:hover{background:#172943}a{color:#80d9ff;text-decoration:none}a:hover{text-decoration:underline}.kind{color:#74dcb9;font-size:1.25rem;text-align:center}</style></head><body><main><p><a href="/">Eliware GlusterFS</a></p><h1>${escapeHtml(title)}</h1><table><thead><tr><th></th><th>Name</th><th>Size</th><th>Modified</th></tr></thead><tbody>${rows.join("")}</tbody></table></main></body></html>`;
  let body = fallback;
  try {
    body = (await fs.readFile(config.directoryTemplate, "utf8"))
      .replaceAll("{{TITLE}}", escapeHtml(title))
      .replaceAll("{{OG_IMAGE}}", escapeHtml(ogImage))
      .replaceAll("{{OG_DESCRIPTION}}", escapeHtml(ogDescription))
      .replaceAll("{{ROWS}}", rows.join(""))
      .replaceAll("{{BREADCRUMBS}}", renderBreadcrumbs(requestPath))
      .replaceAll("{{PATH}}", escapeHtml(requestPath))
      .replaceAll(
        "{{VALIDATION}}",
        renderValidation(validation, containerValidation),
      )
      .replaceAll(
        "{{SUMMARY}}",
        `Total files: ${fileCount} · Total size: ${formatBytes(totalBytes)}`,
      )
      .replaceAll("__COPYRIGHT_YEAR__", copyrightYear())
      .replaceAll("__APP_VERSION__", process.env.APP_VERSION || APP_VERSION)
      .replaceAll("__HOST_ID__", servingHostId());
  } catch {
    /* use built-in fallback */
  }
  const contentType = "text/html; charset=utf-8";
  const encoded = await compressBody(
    Buffer.from(body),
    request,
    contentType,
    config,
  );
  response.writeHead(200, {
    ...baseHeaders(config),
    "Content-Type": contentType,
    "Content-Length": encoded.body.length,
    ...encoded.headers,
  });
  response.end(request.method === "HEAD" ? undefined : encoded.body);
}
