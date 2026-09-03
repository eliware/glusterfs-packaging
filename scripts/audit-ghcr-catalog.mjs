#!/usr/bin/env node
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { env, run } from "./lib.mjs";

const catalogFile = env(
  "CATALOG_FILE",
  path.join(env("PUBLISH_ROOT", "/mnt/pvc/gluster-repository-http"), "metadata/catalog.json"),
);
const owner = env("GHCR_OWNER", "eliware");
const defaultPackages = [
  "alma10-gluster",
  "centos10-gluster",
  "debian12-gluster",
  "oracle10-gluster",
  "rocky10-gluster",
  "ubuntu24-gluster",
];
const packages = (env("GHCR_PACKAGES", defaultPackages.join(",")))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export function collectCatalogImages(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectCatalogImages(item, output);
  } else if (value && typeof value === "object") {
    if (typeof value.reference === "string" && value.reference.startsWith("ghcr.io/"))
      output.add(value.reference);
    for (const child of Object.values(value)) collectCatalogImages(child, output);
  }
  return output;
}

function imageReference(packageName, tag) {
  return `ghcr.io/${owner}/${packageName}:${tag}`;
}

async function ghcrTaggedImages(packageName) {
  const result = await run(
    "gh",
    [
      "api",
      `orgs/${owner}/packages/container/${packageName}/versions?per_page=100`,
      "--paginate",
      "--jq",
      ".[] | select((.metadata.container.tags // []) | length > 0) | [.metadata.container.tags[], .name, .created_at] | @tsv",
    ],
    { capture: true },
  );
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [tag, digest, createdAt] = line.split("\t");
      return {
        package: packageName,
        tag,
        digest,
        createdAt,
        reference: imageReference(packageName, tag),
      };
    });
}

export async function auditCatalog() {
  const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
  const catalogImages = collectCatalogImages(catalog);
  const ghcrImages = (await Promise.all(packages.map(ghcrTaggedImages))).flat();
  const orphans = ghcrImages.filter(({ reference }) => !catalogImages.has(reference));
  return { catalogImages, ghcrImages, orphans };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { catalogImages, ghcrImages, orphans } = await auditCatalog();
  console.log(`Catalog images: ${catalogImages.size}`);
  console.log(`GHCR tagged images checked: ${ghcrImages.length}`);
  console.log(`Orphans: ${orphans.length ? orphans.length : "none"}`);
  for (const image of orphans.sort((a, b) => a.reference.localeCompare(b.reference)))
    console.log(`${image.reference}\t${image.createdAt}\t${image.digest}`);
  process.exitCode = orphans.length ? 1 : 0;
}
