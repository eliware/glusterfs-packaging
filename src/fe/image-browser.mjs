import { fetchCatalog } from "./api.mjs";
import { getElement } from "./dom.mjs";
import { formatDateTime, previewCommit, previewDate } from "./format.mjs";

let records = [];
let openRepository = null;
let currentExample = null;
let exampleReferenceMode = "latest";
let catalog = {};
const distroLabels = {
  "centos-stream": "CentOS Stream",
  rocky: "Rocky Linux",
  alma: "AlmaLinux",
  oracle: "Oracle Linux",
  debian: "Debian",
  ubuntu: "Ubuntu",
};
const distroReleases = {
  "centos-stream": "10",
  rocky: "10",
  alma: "10",
  oracle: "10",
  debian: "12",
  ubuntu: "24.04",
};

function distroFromRepository(repository) {
  const name = repository.split("/").at(-1) || "";
  return (
    {
      "centos10-gluster": "centos-stream",
      "rocky10-gluster": "rocky",
      "alma10-gluster": "alma",
      "oracle10-gluster": "oracle",
      "debian12-gluster": "debian",
      "ubuntu2404-gluster": "ubuntu",
    }[name] || "centos-stream"
  );
}

function imageRecords(data) {
  return (data.images || []).map((record) => {
    const repository = record.image?.repository || "";
    const distro =
      record.distribution ||
      record.distro ||
      record.image?.distribution ||
      distroFromRepository(repository);
    const channel =
      record.channel || (record.source?.ref === "devel" ? "rolling" : "stable");
    return {
      ...record,
      distro,
      distroLabel: distroLabels[distro] || distro,
      repository,
      release: distroReleases[distro] || "unknown",
      arch: "x86_64",
      channel,
      version:
        channel === "preview" || channel === "rolling"
          ? record.candidate || record.version || "unknown"
          : record.version || "unknown",
    };
  });
}

function selectedRecords() {
  const distro = getElement("target-distro")?.value;
  const channel = getElement("target-channel")?.value;
  const version = getElement("target-version")?.value;
  const stableVersion = catalog.stable?.version;
  return records.filter(
    (record) =>
      record.distro === distro &&
      record.channel === channel &&
      (channel === "stable"
        ? record.version === (version === "stable" ? stableVersion : version)
        : record.candidate === version),
  );
}

function displaySource(record) {
  if (record.channel === "rolling" || record.channel === "preview")
    return `${previewDate(record)} · ${previewCommit(record)}`;
  return record.source?.ref || `GlusterFS ${record.version}`;
}

function folderRow(list, repository) {
  const article = document.createElement("article");
  article.className = "image-entry image-folder";
  const button = document.createElement("button");
  button.className = "image-folder-button";
  button.type = "button";
  button.innerHTML = '<span class="glyph" aria-hidden="true">📁</span>';
  const content = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = `${repository.split("/").at(-1)}/`;
  const count = document.createElement("span");
  count.className = "muted small";
  count.textContent = `${selectedRecords().filter((record) => record.repository === repository).length} images`;
  content.append(title, count);
  button.append(content);
  button.addEventListener("click", () => {
    openRepository = repository;
    render();
  });
  article.appendChild(button);
  list.appendChild(article);
}

function exampleReference(record) {
  if (exampleReferenceMode === "sha")
    return `${record.image.repository}@${record.image.digest}`;
  if (exampleReferenceMode === "tag") return record.image.reference;
  return `${record.image.repository}:latest`;
}

function exampleFor(record, kind) {
  const ref = exampleReference(record);
  if (kind === "dockerfile")
    return `FROM ${ref}\n\n# Add your application and configuration here.\nCMD ["glusterd", "-N"]\n`;
  if (kind === "compose")
    return `services:\n  gluster:\n    image: ${ref}\n    privileged: true\n    restart: unless-stopped\n    volumes:\n      - gluster-data:/var/lib/glusterd\n\nvolumes:\n  gluster-data:\n`;
  return `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: gluster\nspec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app: gluster\n  template:\n    metadata:\n      labels:\n        app: gluster\n    spec:\n      containers:\n        - name: gluster\n          image: ${ref}\n          securityContext:\n            privileged: true\n`;
}

function renderExample() {
  if (!currentExample) return;
  const panel = getElement("image-example-panel");
  const title = getElement("image-example-title");
  const code = getElement("image-example-code");
  if (!panel || !title || !code) return;
  const { record, kind } = currentExample;
  title.textContent = `${kind === "dockerfile" ? "Dockerfile" : kind === "compose" ? "Compose" : "Kubernetes"} · ${record.repository.split("/").at(-1)}`;
  code.textContent = exampleFor(record, kind);
  document
    .querySelectorAll("[data-image-example-reference]")
    .forEach((button) => {
      const active =
        button.dataset.imageExampleReference === exampleReferenceMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  document.querySelectorAll("[data-image-example-kind]").forEach((button) => {
    const active = button.dataset.imageExampleKind === kind;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function showExample(record, kind) {
  currentExample = { record, kind };
  renderExample();
  const panel = getElement("image-example-panel");
  if (!panel) return;
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function imageRow(list, record) {
  const article = document.createElement("article");
  article.className = "image-entry";
  const heading = document.createElement("div");
  heading.className = "image-entry-heading";
  const title = document.createElement("h3");
  title.textContent = `${record.channel === "rolling" ? "Rolling" : "Stable"} · GlusterFS ${record.version}`;
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = `${record.distroLabel} ${record.release} · ${record.arch}`;
  heading.append(title, badge);
  const details = document.createElement("p");
  details.className = "muted small";
  details.textContent = `Built ${formatDateTime(record.built)} · Source ${displaySource(record)}`;
  const reference = document.createElement("code");
  reference.textContent = record.image.reference;
  const digest = document.createElement("code");
  digest.textContent = record.image.digest;
  const refs = document.createElement("div");
  refs.className = "image-entry-references";
  refs.append(reference, digest);
  article.classList.add("image-entry-selectable");
  article.title = "Show configuration examples for this image";
  article.addEventListener("click", () => showExample(record, "dockerfile"));
  article.append(heading, details, refs);
  list.appendChild(article);
}

function renderBreadcrumbs() {
  const breadcrumbs = getElement("image-browser-breadcrumbs");
  if (!breadcrumbs) return;
  breadcrumbs.replaceChildren();
  const root = document.createElement("button");
  root.type = "button";
  root.className = "breadcrumb-link";
  root.textContent = "Images";
  root.addEventListener("click", () => {
    openRepository = null;
    render();
  });
  breadcrumbs.appendChild(root);
  if (openRepository) {
    const separator = document.createElement("span");
    separator.textContent = " / ";
    breadcrumbs.append(separator);
    const current = document.createElement("span");
    current.textContent = openRepository.split("/").at(-1);
    breadcrumbs.append(current);
  }
}

function render() {
  const list = getElement("image-list");
  const status = getElement("image-browser-status");
  if (!list || !status) return;
  renderBreadcrumbs();
  list.replaceChildren();
  const visible = selectedRecords();
  const repositories = [...new Set(visible.map((record) => record.repository))];
  if (!openRepository) {
    if (repositories.length > 1) {
      repositories.sort().forEach((repository) => folderRow(list, repository));
    } else visible.forEach((record) => imageRow(list, record));
    status.textContent = `${visible.length} images · ${repositories.length} repositories`;
    if (!currentExample && visible[0]) {
      currentExample = { record: visible[0], kind: "dockerfile" };
      const panel = getElement("image-example-panel");
      if (panel) panel.hidden = false;
      renderExample();
    }
    return;
  }
  visible
    .filter((record) => record.repository === openRepository)
    .forEach((record) => imageRow(list, record));
  status.textContent = `${visible.filter((record) => record.repository === openRepository).length} images`;
}

export async function initImageBrowser() {
  if (!getElement("image-list")) return;
  try {
    catalog = await fetchCatalog();
    records = imageRecords(catalog);
    document
      .querySelectorAll("[data-image-example-reference]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          exampleReferenceMode = button.dataset.imageExampleReference;
          renderExample();
        }),
      );
    ["target-distro", "target-channel", "target-version"].forEach((id) =>
      getElement(id)?.addEventListener("change", () => {
        openRepository = null;
        currentExample = null;
        const panel = getElement("image-example-panel");
        if (panel) panel.hidden = true;
        render();
      }),
    );
    document.querySelectorAll("[data-image-example-kind]").forEach((button) =>
      button.addEventListener("click", () => {
        if (!currentExample) return;
        currentExample.kind = button.dataset.imageExampleKind;
        renderExample();
      }),
    );
    document.addEventListener("target-selection-ready", render);
    render();
  } catch {
    const status = getElement("image-browser-status");
    if (status)
      status.textContent = "Image metadata is temporarily unavailable.";
  }
}
