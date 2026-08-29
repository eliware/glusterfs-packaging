#!/usr/bin/env node
import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { readMetadata, writeMetadata } from "./metadata-io.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index].startsWith("--"))
    args.set(process.argv[index].slice(2), process.argv[index + 1]);
}

const recordFiles = async (directory) => {
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
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const record = await readMetadata(file);
        if (record?.channel && record?.distribution && record?.version)
          records.push(record);
      }
    }
  };
  await walk(directory);
  return records;
};

const failureTargets = async (directory) => {
  const failures = new Map();
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
      else if (entry.name === "failure-record.json") {
        const record = await readMetadata(file, { allowMissing: true });
        if (record?.lane && record?.distribution && record?.package_candidate)
          failures.set(
            `${record.package_candidate}:${record.distribution}`,
            record.failed_at || null,
          );
      }
    }
  };
  await walk(directory);
  return failures;
};

const newest = (records) =>
  [...records].sort((left, right) =>
    String(right.built || right.generated).localeCompare(
      String(left.built || left.generated),
    ),
  )[0] || null;

export async function rebuildCatalog({ root, output, generation = null }) {
  await mkdir(path.join(root, "metadata"), { recursive: true });
  const stableRecords = await recordFiles(
    path.join(root, "metadata/records/stable"),
  );
  const previewRecords = await recordFiles(
    path.join(root, "metadata/records/preview"),
  );
  const packageRecords = [...stableRecords, ...previewRecords].filter(
    (record) => record.package,
  );
  const packageKey = (record) =>
    [
      record.channel,
      record.package?.format,
      record.package?.distribution,
      record.version,
    ]
      .filter(Boolean)
      .join(":");
  const packages = Array.from(
    new Map(
      packageRecords.map((record) => [packageKey(record), record]),
    ).values(),
  ).sort((left, right) =>
    String(right.built || right.generated).localeCompare(
      String(left.built || left.generated),
    ),
  );
  const stablePackages = stableRecords.filter((record) => record.package);
  const previewPackages = previewRecords
    .filter((record) => record.package)
    .sort((left, right) =>
      String(right.built || right.generated).localeCompare(
        String(left.built || left.generated),
      ),
    );
  const previews = Array.from(
    new Map(
      previewPackages.map((record) => [record.candidate, record]),
    ).values(),
  ).slice(0, 30);
  const previousCatalog = await readMetadata(
    path.join(root, "metadata/catalog.json"),
    { allowMissing: true },
  );
  const failedImages = await failureTargets(path.join(root, "metadata/runs"));
  const imageRecords = [...stableRecords, ...previewRecords].filter(
    (record) =>
      record.image?.repository &&
      record.image?.digest &&
      (() => {
        const failedAt = failedImages.get(
          `${record.image.package_candidate}:${record.image.distribution}`,
        );
        return !failedAt || String(record.built || record.generated) > failedAt;
      })(),
  );
  const images = Array.from(
    new Map(
      imageRecords.map((record) => [record.image.digest, record]),
    ).values(),
  ).sort((left, right) =>
    String(right.built).localeCompare(String(left.built)),
  );
  const activeGeneration =
    generation ||
    previousCatalog?.active_generation ||
    (
      await readMetadata(path.join(root, "metadata/active-generation.json"), {
        allowMissing: true,
      })
    )?.generation ||
    null;
  const catalog = {
    schema: 1,
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    active_generation: activeGeneration,
    stable: newest(stablePackages) || {},
    preview: {
      available: previews.length > 0,
      retention: 30,
      latest: previews[0] || null,
      items: previews,
    },
    packages,
    images,
  };
  await writeMetadata(path.join(root, "metadata/packages.json"), {
    schema: 1,
    generated: new Date().toISOString(),
    packages,
  });
  await writeMetadata(output, catalog, { atomic: true });
  return catalog;
}

if (args.get("publish-root") && args.get("output")) {
  const catalog = await rebuildCatalog({
    root: args.get("publish-root"),
    output: args.get("output"),
    generation: args.get("generation") || null,
  });
  console.log(
    `Rebuilt catalog: ${catalog.packages.length} packages, ${catalog.images.length} images`,
  );
}
