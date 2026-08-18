import path from "node:path";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer";
import { withMetadataVersion } from "./metadata-version.mjs";

const PLATFORM_LABELS = {
  "centos-stream": "CentOS Stream 10",
  rocky: "Rocky Linux 10",
  alma: "AlmaLinux 10",
  oracle: "Oracle Linux 10",
  debian: "Debian 12",
  ubuntu: "Ubuntu 24.04",
};
const RPM_PLATFORM_IDS = ["centos-stream", "rocky", "alma", "oracle"];

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const short = (value = "") => String(value).slice(0, 12);
const imageEntries = (result) => Object.values(result.images || {});
const packageValidation = (result) =>
  result.package?.validation || result.build?.validation;
const checks = (validation) => Object.values(validation?.checks || {});
const checkCounts = (validation) => {
  const values = checks(validation);
  return {
    passed: values.filter((check) => check?.status === "passed").length,
    total: values.length,
  };
};

function imageUrl(image) {
  const repository = String(image || "")
    .replace(/^ghcr\.io\//, "")
    .split(":")[0];
  return repository
    ? `https://github.com/eliware/glusterfs-packaging/pkgs/container/${repository.split("/").at(-1)}`
    : "";
}

function platformForPackage(result) {
  return result.build?.package_format === "rpm"
    ? "centos-stream"
    : result.build?.distribution;
}

export function buildPlatformData(results) {
  const platforms = new Map(
    Object.keys(PLATFORM_LABELS).map((id) => [
      id,
      {
        id,
        label: PLATFORM_LABELS[id],
        packages: [],
        images: [],
        failures: [],
      },
    ]),
  );
  let passedChecks = 0;
  let totalChecks = 0;
  const versions = new Set();
  const commits = new Set();
  for (const result of results) {
    if (result.status !== "published" && result.status !== "fulfilled") {
      const lane = result.id || result.lane || "unknown lane";
      const target = platforms.get(
        lane.startsWith("epel") ? "centos-stream" : lane.split("-")[0],
      );
      (target || platforms.get("centos-stream")).failures.push(
        result.error || "lane failed",
      );
      continue;
    }
    const platform = platformForPackage(result);
    const build = result.build || {};
    const packageTargets =
      build.package_format === "rpm"
        ? RPM_PLATFORM_IDS.map((id) => platforms.get(id))
        : [platforms.get(platform)];
    for (const packageTarget of packageTargets.filter(Boolean)) {
      packageTarget.packages.push({
        format: String(build.package_format || "package").toUpperCase(),
        channel: build.channel || "unknown",
        version: build.version || build.package_version || "unknown",
        commit: short(build.source_commit || result.source_commit),
        provenance: result.package?.provenance || "",
      });
    }
    if (build.version)
      versions.add(`${build.channel || "release"} ${build.version}`);
    if (build.source_commit || result.source_commit)
      commits.add(short(build.source_commit || result.source_commit));
    const packageCounts = checkCounts(packageValidation(result));
    passedChecks += packageCounts.passed;
    totalChecks += packageCounts.total;
    for (const checkpoint of imageEntries(result)) {
      const image = checkpoint.result || checkpoint;
      const imageTarget = platforms.get(
        image.distribution || checkpoint.distribution,
      );
      if (!imageTarget) continue;
      const imageCounts = checkCounts(
        image.container_validation || checkpoint.container_validation,
      );
      passedChecks += imageCounts.passed;
      totalChecks += imageCounts.total;
      imageTarget.images.push({
        image: image.image || "unknown image",
        digest: image.digest || "",
        package_candidate:
          image.package_candidate || checkpoint.package_candidate || "",
        base_image: image.base_image || checkpoint.base_image || "",
        base_image_digest: image.base_image_digest || "",
        version: image.version || checkpoint.version || "unknown",
        channel: image.channel || build.channel || "unknown",
        url: imageUrl(image.image),
      });
    }
  }
  return {
    platforms: [...platforms.values()].filter(
      (platform) =>
        platform.packages.length ||
        platform.images.length ||
        platform.failures.length,
    ),
    versions: [...versions],
    commits: [...commits],
    validation: { passed: passedChecks, total: totalChecks },
  };
}

function fieldValue(lines, empty = "No artifacts") {
  return lines.length ? lines.join("\n") : empty;
}

export async function generateReleaseReport({
  runId,
  results,
  outputRoot = "/var/lib/gluster-packaging/repository",
  baseUrl = "https://glusterfs.eliware.org",
}) {
  const directory = path.join(outputRoot, "metadata", "runs", runId);
  await mkdir(directory, { recursive: true });
  const logo = await readFile(
    "/opt/gluster-packaging/assets/eliware-brand.svg",
  );
  const logoData = `data:image/svg+xml;base64,${logo.toString("base64")}`;
  const successful = results.filter(
    (result) => result.status === "published" || result.status === "fulfilled",
  ).length;
  const failed = results.length - successful;
  const data = buildPlatformData(results);
  const packageCount = results.filter(
    (result) =>
      (result.status === "published" || result.status === "fulfilled") &&
      result.build?.package_format,
  ).length;
  const images = data.platforms.reduce(
    (total, platform) => total + platform.images.length,
    0,
  );
  const status = failed ? "✕ VALIDATION FAILED" : "✓ PASSED · VALIDATION";
  const statusColor = failed ? "#ef6b73" : "#55d68a";
  const cardUrl = `${baseUrl}/metadata/runs/${runId}/release-card.png`;
  const reportUrl = `${baseUrl}/metadata/runs/${runId}/release-report.json`;
  const latestCardUrl = `${baseUrl}/metadata/latest-release-card.png`;
  const rows = data.platforms
    .map((platform) => {
      const packageText = platform.packages.length
        ? platform.packages
            .map((item) => `${item.format} ${item.channel} ${item.version}`)
            .join(" · ")
        : "—";
      const imageText = platform.images.length
        ? `${platform.images.length} passed`
        : "—";
      return `<div class="row"><div>${platform.failures.length ? "✕" : "✓"} ${escapeHtml(platform.label)}</div><div>${packageText}</div><div>${imageText}</div></div>`;
    })
    .join("");
  const packageFields = data.platforms.flatMap((platform) =>
    platform.packages.map((item) => {
      const link = item.provenance
        ? `${baseUrl}${item.provenance.startsWith("/") ? item.provenance : `/${item.provenance}`}`
        : "";
      return `${platform.label}: ${item.format} ${item.channel} ${item.version}${link ? ` ([provenance](${link}))` : ""}`;
    }),
  );
  const imageFields = data.platforms.flatMap((platform) =>
    platform.images.map(
      (item) =>
        `${platform.label}: ${item.image}${item.url ? ` ([GHCR](${item.url}))` : ""}`,
    ),
  );
  const fields = [
    {
      name: "Operating systems",
      value: fieldValue(
        data.platforms.map(
          (platform) =>
            `${platform.failures.length ? "✕" : "✓"} ${platform.label}`,
        ),
      ),
    },
    { name: "Packages", value: fieldValue(packageFields) },
    { name: "Images", value: fieldValue(imageFields) },
    {
      name: "Validation",
      value: `${data.validation.passed}/${data.validation.total || 0} checks passed`,
    },
  ];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1200px; height: 630px; color: #f4f8ff; background: #08111f; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  .card { height: 100%; padding: 54px 64px; background: radial-gradient(circle at 88% 12%, #17446c 0, #0d2038 32%, #08111f 72%); position: relative; overflow: hidden; }
  .card::after { content: ""; position: absolute; width: 520px; height: 520px; right: -180px; bottom: -240px; border: 1px solid rgba(85,214,138,.35); border-radius: 50%; box-shadow: 0 0 0 36px rgba(85,214,138,.04), 0 0 0 72px rgba(85,214,138,.03); }
  .brand { display: flex; align-items: center; gap: 18px; position: relative; z-index: 1; }
  .brand img { width: 44px; height: 44px; object-fit: contain; }
  .eyebrow { color: #8fb7dc; font-size: 18px; letter-spacing: .18em; text-transform: uppercase; }
  h1 { margin: 30px 0 8px; font-size: 48px; line-height: 1.05; letter-spacing: -.03em; position: relative; z-index: 1; }
  .subtitle { color: #b7cbe0; font-size: 21px; position: relative; z-index: 1; }
  .stamp { position: absolute; top: 54px; right: 74px; border: 3px solid ${statusColor}; color: ${statusColor}; border-radius: 999px; padding: 13px 20px; font-weight: 900; letter-spacing: .08em; font-size: 16px; transform: rotate(4deg); z-index: 2; box-shadow: 0 0 0 5px rgba(85,214,138,.08), 0 8px 24px rgba(0,0,0,.22); }
  .stats { display: flex; gap: 16px; margin-top: 24px; position: relative; z-index: 1; }
  .stat { min-width: 170px; padding: 10px 18px; border: 1px solid rgba(143,183,220,.25); border-radius: 12px; background: rgba(13,32,56,.7); }
  .stat strong { display: block; font-size: 24px; color: #55d68a; }
  .stat span { color: #a9c1d9; font-size: 14px; }
  .matrix { margin-top: 22px; border: 1px solid rgba(143,183,220,.25); border-radius: 14px; overflow: hidden; position: relative; z-index: 1; background: rgba(8,17,31,.55); }
  .matrix-head, .row { display: grid; grid-template-columns: 1.35fr 1.55fr 1fr; }
  .matrix-head { color: #8fb7dc; text-transform: uppercase; letter-spacing: .12em; font-size: 13px; background: rgba(23,68,108,.55); }
  .matrix-head div, .row div { padding: 5px 16px; border-right: 1px solid rgba(143,183,220,.15); }
  .matrix-head div { padding-top: 7px; padding-bottom: 7px; }
  .matrix-head div:last-child, .row div:last-child { border-right: 0; }
  .row { color: #e7f0fb; font-size: 14px; border-top: 1px solid rgba(143,183,220,.13); }
  .row div:nth-child(2), .row div:nth-child(3) { color: #b7cbe0; }
  .footer { position: absolute; left: 64px; right: 64px; bottom: 24px; display: flex; justify-content: space-between; color: #7797b7; font-size: 13px; z-index: 1; }
</style></head><body><main class="card">
  <div class="stamp">${status}</div>
  <div class="brand"><img src="${logoData}" alt="Eliware"><div><div class="eyebrow">Eliware · Release Conductor</div><div style="font-size:20px;font-weight:700">GlusterFS packaging</div></div></div>
  <h1>Verified multi-platform release</h1>
  <div class="subtitle">Run ${escapeHtml(runId)} · ${escapeHtml(data.versions.join(" · ") || "release metadata")}</div>
  <div class="stats"><div class="stat"><strong>${successful}/${results.length}</strong><span>lanes successful</span></div><div class="stat"><strong>${packageCount}</strong><span>package lanes</span></div><div class="stat"><strong>${images}</strong><span>container images</span></div><div class="stat"><strong>${data.validation.passed}/${data.validation.total}</strong><span>checks passed</span></div></div>
  <section class="matrix"><div class="matrix-head"><div>Operating system</div><div>Packages</div><div>Images</div></div>${rows}</section>
  <div class="footer"><span>glusterfs.eliware.org</span><span>Immutable artifacts · signed provenance</span></div>
</main></body></html>`;
  const htmlPath = path.join(directory, "release-card.html");
  const pngPath = path.join(directory, "release-card.png");
  const reportPath = path.join(directory, "release-report.json");
  await writeFile(htmlPath, html);
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: pngPath, type: "png" });
  } finally {
    await browser.close();
  }
  const report = withMetadataVersion({
    run_id: runId,
    generated: new Date().toISOString(),
    status: failed ? "attention" : "certified",
    lanes_successful: successful,
    lanes_total: results.length,
    package_lanes: packageCount,
    image_count: images,
    platforms: data.platforms,
    versions: data.versions,
    source_commits: data.commits,
    validation: data.validation,
    card: {
      png: cardUrl,
      latest: latestCardUrl,
      report: reportUrl,
      width: 1200,
      height: 630,
      type: "image/png",
    },
  });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const latestPath = path.join(
    outputRoot,
    "metadata",
    "latest-release-card.png",
  );
  await copyFile(pngPath, latestPath);
  await writeFile(
    path.join(outputRoot, "metadata", "latest-release-report.json"),
    `${JSON.stringify(withMetadataVersion({ run_id: runId, report: reportUrl, card: latestCardUrl }), null, 2)}\n`,
  );
  return {
    cardUrl,
    reportUrl,
    latestCardUrl,
    fields,
    imageCount: images,
    packageCount,
    successful,
    total: results.length,
  };
}
