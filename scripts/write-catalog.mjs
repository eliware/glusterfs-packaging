#!/usr/bin/env node
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { readMetadata, writeMetadata } from "./metadata-io.mjs";
import { withMetadataVersion } from "./metadata-version.mjs";
import { catalogRepositoryLinks } from "./catalog-repositories.mjs";
import { assertValidationRecord } from "./validation-schema.mjs";
import { packagePublicationRelativePath } from "./publication-paths.mjs";
const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const option = process.argv[i];
  if (!option.startsWith("--")) throw new Error(`unexpected argument: ${option}`);
  const name = option.slice(2);
  const value = process.argv[++i];
  if (!value || value.startsWith("--")) throw new Error(`missing value for --${name}`);
  if (args.has(name)) throw new Error(`duplicate option: --${name}`);
  args.set(name, value);
}
const required = (key) => {
  const value = args.get(key);
  if (!value) throw new Error(`missing --${key}`);
  return value;
};
const output = required("output");
const root = args.get("publish-root");
const channel = args.get("channel") || "stable";
const candidate = required("candidate");
const packageOnly = args.get("package-only") === "1";
const imageReference = args.get("image") || "";
const imageDigest = args.get("digest") || "";
const imageTag = imageReference ? imageReference.split(":").at(-1) : "";
const imagePackageCandidate = args.get("package-candidate") || "";
const imageBase = args.get("base-image") || "";
const imageBaseDigest = args.get("base-image-digest") || "";
const distribution = args.get("distribution") || "centos-stream";
const packageFormat =
  args.get("package-format") ||
  (["debian", "ubuntu"].includes(distribution) ? "deb" : "rpm");
const repositoryLinks = catalogRepositoryLinks({
  packageFormat,
  distribution,
  channel,
  candidate,
  suite: args.get("suite") || undefined,
});
const provenanceUrl = args.get("provenance") || "";
const packageProvenanceUrl = args.get("package-provenance") || provenanceUrl;
const publicationGeneration = args.get("generation") || null;
let validation = null;
if (args.get("validation-file")) {
  validation = JSON.parse(await readFile(args.get("validation-file"), "utf8"));
}
let containerValidation = null;
if (args.get("container-validation-file")) {
  containerValidation = JSON.parse(
    await readFile(args.get("container-validation-file"), "utf8"),
  );
}
if (validation)
  assertValidationRecord(validation, {
    coreField: "package_core",
    label: "package",
  });
if (containerValidation)
  assertValidationRecord(containerValidation, {
    coreField: "container_core",
    label: "container",
  });
const record = withMetadataVersion({
  channel,
  distribution,
  version: required("version"),
  built: required("built"),
  candidate,
  source: {
    ref: args.get("source-ref") || "release",
    commit: args.get("source-commit") || "unknown",
  },
  ...(validation ? { validation } : {}),
  ...(containerValidation ? { container_validation: containerValidation } : {}),
  ...(validation?.repository_integrity
    ? { repository_integrity: validation.repository_integrity }
    : {}),
  ...(validation?.provenance_verification
    ? { provenance_verification: validation.provenance_verification }
    : {}),
  ...(provenanceUrl ? { provenance: { url: provenanceUrl } } : {}),
  ...(repositoryLinks.rpm_repo
    ? { rpm_repo: args.get("rpm-repo") || repositoryLinks.rpm_repo }
    : { deb_repos: repositoryLinks.deb_repos }),
  ...(packageOnly
    ? {
        package: {
          format: packageFormat,
          distribution,
          suite: args.get("suite") || null,
          version: args.get("package-version") || required("version"),
          repositories: repositoryLinks.repositories,
          ...(packageProvenanceUrl
            ? { provenance: { url: packageProvenanceUrl } }
            : {}),
        },
      }
    : {
        image: {
          repository: imageReference.split(":")[0],
          distribution,
          package_candidate: imagePackageCandidate,
          base_image: imageBase,
          exact_tag: imageTag,
          reference: imageReference,
          digest: imageDigest,
          aliases: (args.get("image-aliases") || "").split(",").filter(Boolean),
          base: {
            digest: imageBaseDigest || "unknown",
            short:
              imageBaseDigest.replace(/^sha256:/, "").slice(0, 8) || "unknown",
          },
          ...(provenanceUrl ? { provenance: { url: provenanceUrl } } : {}),
          ...(packageProvenanceUrl
            ? { package_provenance: { url: packageProvenanceUrl } }
            : {}),
        },
      }),
});
if (!packageOnly) {
  if (!imageReference || !imageDigest.startsWith("sha256:"))
    throw new Error("image catalog record requires an immutable digest");
  if (!imagePackageCandidate || !imageBase || !imageBaseDigest)
    throw new Error(
      "image catalog record requires package candidate and immutable base image",
    );
  if (!provenanceUrl || !packageProvenanceUrl)
    throw new Error(
      "image catalog record requires package and image provenance",
    );
  if (!containerValidation)
    throw new Error("image catalog record requires container validation");
} else if (!packageProvenanceUrl) {
  throw new Error("package catalog record requires package provenance");
}
const readJson = async (file) => {
  return readMetadata(file, { allowMissing: true });
};
const recordName = (value) => String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
const readRecordFiles = async (directory) => {
  const records = [];
  const walk = async (current) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith(".json")) {
        const item = await readJson(file);
        if (item?.channel && item?.distribution && item?.version)
          records.push(item);
      }
    }
  };
  await walk(directory);
  return records;
};
if (root) {
  await mkdir(path.join(root, "metadata"), { recursive: true });
  const recordDirectory = path.join(
    root,
    "metadata/records",
    channel,
    recordName(record.distribution),
  );
  await mkdir(recordDirectory, { recursive: true });
  await writeMetadata(
    path.join(
      recordDirectory,
      `${recordName(candidate)}-${packageOnly ? "package" : "image"}.json`,
    ),
    record,
  );
  if (channel === "stable")
    await writeMetadata(path.join(root, "metadata/stable.json"), record);
  else {
    const dir = path.join(
      root,
      packagePublicationRelativePath({
        packageFormat,
        distribution,
        suite: args.get("suite") || undefined,
        channel,
        candidate,
      }),
    );
    await mkdir(dir, { recursive: true });
    await writeMetadata(path.join(dir, "metadata.json"), record);
  }
}
const allStableRecords = root
  ? await readRecordFiles(path.join(root, "metadata/records/stable"))
  : channel === "stable"
    ? [record]
    : [];
const allPreviewRecords = root
  ? await readRecordFiles(path.join(root, "metadata/records/preview"))
  : channel === "preview"
    ? [record]
    : [];
const newest = (items) =>
  [...items].sort((a, b) =>
    String(b.built || b.generated).localeCompare(
      String(a.built || a.generated),
    ),
  )[0] || null;
const stable = newest(allStableRecords);
const previewRecords = allPreviewRecords.sort((a, b) =>
  String(b.built || b.generated).localeCompare(String(a.built || a.generated)),
);
const previews = Array.from(
  new Map(previewRecords.map((item) => [item.candidate, item])).values(),
).slice(0, 30);
const previousCatalog = root
  ? await readJson(path.join(root, "metadata/catalog.json"))
  : null;
const previousPackages = root
  ? await readJson(path.join(root, "metadata/packages.json"))
  : null;
const existingPackages = previousPackages?.packages || [];
const packageKey = (item) =>
  [item.channel, item.package?.format, item.package?.distribution, item.version]
    .filter(Boolean)
    .join(":");
const packageRecords = [...allStableRecords, ...allPreviewRecords].filter(
  (item) => item.package,
);
const packages = Array.from(
  new Map(
    [...existingPackages, ...packageRecords].map((item) => [
      packageKey(item),
      item,
    ]),
  ).values(),
).sort((a, b) =>
  String(b.built || b.generated).localeCompare(String(a.built || a.generated)),
);
if (root)
  await writeMetadata(path.join(root, "metadata/packages.json"), {
    schema: 1,
    generated: new Date().toISOString(),
    packages,
  });
const imageRecords = [
  ...(previousCatalog?.images || []),
  ...allStableRecords.filter((item) => item.image),
  ...allPreviewRecords.filter((item) => item.image),
];
const images = Array.from(
  new Map(
    imageRecords
      .filter((item) => item?.image?.repository && item?.image?.digest)
      .map((item) => [item.image.digest, item]),
  ).values(),
).sort((a, b) => String(b.built).localeCompare(String(a.built)));
await mkdir(path.dirname(output), { recursive: true });
await writeMetadata(
  output,
  {
    schema: 1,
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    active_generation: publicationGeneration,
    stable: stable || {},
    preview: {
      available: previews.length > 0,
      retention: 30,
      latest: previews[0] || null,
      items: previews,
    },
    packages,
    images,
  },
  { atomic: true },
);
