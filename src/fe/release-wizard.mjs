import { fetchCatalog, origin } from "./api.mjs";
import { getElement } from "./dom.mjs";
import { formatDateTime, previewCommit, previewDate } from "./format.mjs";

let catalog = {};
let packageManager = "dnf";
let imageReferenceMode = "tag";

const distroImages = {
  "centos-stream": "ghcr.io/eliware/centos10-gluster",
  rocky: "ghcr.io/eliware/rocky10-gluster",
  alma: "ghcr.io/eliware/alma10-gluster",
  oracle: "ghcr.io/eliware/oracle10-gluster",
  debian: "ghcr.io/eliware/debian12-gluster",
  ubuntu: "ghcr.io/eliware/ubuntu2404-gluster",
};

const distroTargets = {
  "centos-stream": {
    label: "CentOS Stream",
    release: "10",
    family: "rpm",
    repository: "/el10/x86_64",
    repoFile: "/glusterfs-el10.repo",
  },
  rocky: {
    label: "Rocky Linux",
    release: "10",
    family: "rpm",
    repository: "/el10/x86_64",
    repoFile: "/glusterfs-el10.repo",
  },
  alma: {
    label: "AlmaLinux",
    release: "10",
    family: "rpm",
    repository: "/el10/x86_64",
    repoFile: "/glusterfs-el10.repo",
  },
  oracle: {
    label: "Oracle Linux",
    release: "10",
    family: "rpm",
    repository: "/el10/x86_64",
    repoFile: "/glusterfs-el10.repo",
  },
  debian: {
    label: "Debian",
    release: "12",
    family: "apt",
    repository: "/debian/bookworm/amd64",
  },
  ubuntu: {
    label: "Ubuntu",
    release: "24.04",
    family: "apt",
    repository: "/ubuntu/noble/amd64",
  },
};

const distroRepositories = {
  "centos-stream": {
    packages: ["dnf-plugins-core", "epel-release"],
    crb: "crb",
  },
  rocky: { packages: ["dnf-plugins-core"], crb: "crb" },
  alma: { packages: ["dnf-plugins-core"], crb: "crb" },
  oracle: {
    packages: [
      "dnf-plugins-core",
      "oracle-epel-release-el10",
      "oraclelinux-developer-release-el10",
    ],
    crb: "ol10_codeready_builder",
  },
};

function setPackageManager(value) {
  packageManager = value;
  document.querySelectorAll("[data-package-manager]").forEach((button) => {
    const selected = button.dataset.packageManager === value;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  updateCommand();
  updateContainerCommand();
}

function targetConfig() {
  return (
    distroTargets[getElement("target-distro")?.value] ||
    distroTargets["centos-stream"]
  );
}

function setTargetReleaseOptions() {
  const release = getElement("target-release");
  if (!release) return;
  const target = targetConfig();
  release.replaceChildren();
  const option = document.createElement("option");
  option.value = target.release;
  option.textContent = target.release;
  release.appendChild(option);
}

function setVersionOptions() {
  const version = getElement("target-version");
  const channel = getElement("target-channel");
  version.replaceChildren();
  if (channel.value === "stable") {
    const option = document.createElement("option");
    option.value = "stable";
    option.textContent = `Latest stable (${catalog.stable?.version || "unavailable"})`;
    version.appendChild(option);
  } else {
    (catalog.preview?.items || []).forEach((item, index) => {
      const option = document.createElement("option");
      option.value = item.candidate;
      option.textContent = `${index ? "Rolling" : "Latest rolling"} · ${previewDate(item)} · ${previewCommit(item)}`;
      version.appendChild(option);
    });
  }
  if (!version.options.length) {
    const option = document.createElement("option");
    option.textContent = "No builds available";
    version.appendChild(option);
  }
  updateCommand();
  updateContainerCommand();
}

function updateCommand() {
  const distro = getElement("target-distro").value;
  const channel = getElement("target-channel").value;
  const selected = (catalog.preview?.items || []).find(
    (item) => item.candidate === getElement("target-version").value,
  );
  const target = distroTargets[distro] || distroTargets["centos-stream"];
  const preview = channel === "preview";
  const catalogRepository =
    target.family === "apt"
      ? selected?.deb_repos?.[distro] || catalog.stable?.deb_repos?.[distro]
      : selected?.rpm_repo;
  const repoRoot =
    catalogRepository ||
    `${target.repository}/${preview ? `previews/${getElement("target-version").value}` : "stable"}/`;
  const url = origin + repoRoot;
  const title = getElement("package-install-title");
  const managerTools = getElement("package-manager-tools");
  const repoFile = getElement("package-repo-file");
  const repoSeparator = getElement("package-repo-separator");
  const browse = getElement("rpm-browse");
  if (title)
    title.textContent =
      target.family === "apt" ? "Install with apt" : "Install from yum / dnf";
  if (managerTools) managerTools.hidden = target.family !== "rpm";
  if (repoFile) {
    repoFile.hidden = target.family !== "rpm";
    if (target.repoFile) repoFile.href = target.repoFile;
  }
  if (repoSeparator) repoSeparator.hidden = target.family !== "rpm";
  if (browse) browse.href = url;
  if (target.family === "apt") {
    const key = `${origin}/keys/RPM-GPG-KEY-ELIWARE-GLUSTER`;
    const source = `deb [signed-by=/etc/apt/keyrings/eliware-gluster.asc] ${url} stable main`;
    getElement("rpm-command").textContent = [
      "sudo apt-get install -y ca-certificates curl",
      "sudo install -d -m 0755 /etc/apt/keyrings",
      `curl -fsSL ${key} | sudo tee /etc/apt/keyrings/eliware-gluster.asc >/dev/null`,
      `echo "${source}" | sudo tee /etc/apt/sources.list.d/eliware-gluster.list >/dev/null`,
      "sudo apt-get update",
      "sudo apt-get install -y glusterfs-server glusterfs-client glusterfs-cli",
    ].join("\n");
    getElement("rpm-status").textContent =
      `${target.label} ${target.release} ${preview ? "rolling" : "stable"} packages use the signed APT repository.`;
    return;
  }
  const repository =
    distroRepositories[distro] || distroRepositories["centos-stream"];
  const installPrerequisites = `sudo ${packageManager} install -y ${repository.packages.join(" ")}`;
  const enableDependencies = `sudo ${packageManager} config-manager --set-enabled ${repository.crb}`;
  const command = preview
    ? [
        installPrerequisites,
        enableDependencies,
        `sudo ${packageManager} --repofrompath=eliware-rolling,${url} --setopt=eliware-rolling.gpgcheck=1 --setopt=eliware-rolling.repo_gpgcheck=1 --setopt=eliware-rolling.gpgkey=${origin}/keys/RPM-GPG-KEY-ELIWARE-GLUSTER --enablerepo=eliware-rolling install -y glusterfs glusterfs-server glusterfs-fuse glusterfs-selinux`,
      ]
    : [
        installPrerequisites,
        `${enableDependencies} --add-repo ${origin}/glusterfs-el10.repo`,
        `sudo ${packageManager} install -y glusterfs glusterfs-server glusterfs-fuse glusterfs-selinux`,
      ];
  getElement("rpm-command").textContent = command.join("\n");
  getElement("rpm-status").textContent = preview
    ? `${distroLabel(distro)} rolling is enabled only for this command; no repository file is written.`
    : `${distroLabel(distro)} stable installs the persistent repository configuration.`;
}

function setImageReferenceMode(value) {
  imageReferenceMode = value;
  document.querySelectorAll("[data-image-reference]").forEach((button) => {
    const selected = button.dataset.imageReference === value;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  updateContainerCommand();
}

function imagePullReference(image) {
  const name = image?.repository || "ghcr.io/eliware/centos10-gluster";
  if (imageReferenceMode === "tag") return image?.tag || name;
  if (!image?.digest) return image?.tag || name;
  return `${name}@${image.digest}`;
}

function updateContainerCommand() {
  const distro = getElement("target-distro").value;
  const channel = getElement("target-channel").value;
  const selected = (catalog.preview?.items || []).find(
    (item) => item.candidate === getElement("target-version").value,
  );
  const version = getElement("target-version").value;
  const release = channel === "preview" ? selected : catalog.stable;
  const imageRecord = (catalog.images || []).find(
    (item) =>
      (item.image?.repository || "") === distroImages[distro] &&
      item.channel === channel &&
      (channel === "preview"
        ? item.candidate === version
        : item.version === (version === "stable" ? release?.version : version)),
  );
  const selectedImage =
    imageRecord?.image ||
    (distro === "centos-stream" ? release?.image : undefined);
  const latestStable = channel === "stable" && version === "stable";
  const image = imagePullReference({
    ...selectedImage,
    repository: distroImages[distro],
    tag: latestStable
      ? undefined
      : selectedImage?.exact_tag ||
        selectedImage?.reference?.split(":").at(-1) ||
        `${release?.version || version}`,
  });
  getElement("image-ref").textContent = image;
  getElement("image-digest").textContent =
    selectedImage?.digest || "Not published yet";
  const repositoryLink = getElement("image-repository-link");
  if (repositoryLink)
    repositoryLink.href = `https://ghcr.io/${distroImages[distro].replace("ghcr.io/", "")}`;
}

function distroLabel(value) {
  return distroTargets[value]?.label || value;
}

function updateReleaseSummary(data) {
  const stable = data.stable || {};
  const preview = data.preview || {};
  getElement("release").textContent = stable.version || "unavailable";
  getElement("built").textContent = stable.built
    ? formatDateTime(stable.built)
    : "Validated";
  getElement("preview-count").textContent = preview.items?.length || 0;
  if (preview.available)
    getElement("preview-summary").textContent =
      `${preview.items?.length || 0} rolling build${preview.items?.length === 1 ? "" : "s"} available; latest built ${formatDateTime(preview.latest?.built)}.`;
}

export async function initReleaseWizard() {
  if (
    !getElement("release") ||
    !getElement("target-channel") ||
    !getElement("target-version")
  )
    return;
  document
    .querySelectorAll("[data-package-manager]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        setPackageManager(button.dataset.packageManager),
      ),
    );
  document
    .querySelectorAll("[data-image-reference]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        setImageReferenceMode(button.dataset.imageReference),
      ),
    );
  setPackageManager("dnf");
  setImageReferenceMode("tag");
  setTargetReleaseOptions();
  getElement("target-channel").addEventListener("change", setVersionOptions);
  getElement("target-distro").addEventListener("change", () => {
    setTargetReleaseOptions();
    updateCommand();
    updateContainerCommand();
  });
  getElement("target-version").addEventListener("change", () => {
    updateCommand();
    updateContainerCommand();
  });
  try {
    catalog = await fetchCatalog();
    updateReleaseSummary(catalog);
    setVersionOptions();
    updateContainerCommand();
    document.dispatchEvent(new Event("target-selection-ready"));
  } catch {
    getElement("rpm-command").textContent =
      "Release metadata is temporarily unavailable; see the stable repository instructions below.";
  }
}
