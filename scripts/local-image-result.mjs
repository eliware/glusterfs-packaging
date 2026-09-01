import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { run as defaultRun } from "./lib.mjs";
import { parseJson, stringifyJson } from "./serialization.mjs";

function publicationStateFile(config) {
  return config.publicationStateFile || `${config.outputFile}.pending`;
}

async function writeAtomic(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, stringifyJson(value));
  await rename(temporary, file);
}

export async function writePendingImagePublication(config) {
  await writeAtomic(publicationStateFile(config), {
    status: "pending",
    created: new Date().toISOString(),
    image: config.image,
    aliases: config.aliases || [],
    version: config.version,
    distribution: config.distribution,
    package_format: config.packageFormat,
    package_candidate: config.packageCandidate,
    package_provenance: config.packageProvenance,
    base_image: config.baseImage,
    base_image_digest: config.baseImageDigest,
    source_ref: config.sourceRef,
    source_commit: config.sourceCommit,
    packaging_commit: config.packagingCommit,
    rpm_repo_url: config.rpmRepoUrl,
    rpm_metadata_sha256: config.rpmMetadataSha256,
    deb_repo_url: config.debRepoUrl,
    build_log: config.buildLog,
    validation_file: config.validationFile,
    runtime: config.runtime,
    conductor_run_id: config.conductorRunId,
    output_file: config.outputFile,
  });
}

export async function writeLocalImageResult(config) {
  const pushedDigest = (
    await config.run(
      config.runtime,
      [
        "image",
        "inspect",
        "--format",
        "{{range .RepoDigests}}{{println .}}{{end}}",
        config.image,
      ],
      { capture: true },
    )
  ).stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => {
      const reference = config.image.split("@", 1)[0];
      const slash = reference.lastIndexOf("/");
      const colon = reference.lastIndexOf(":");
      const repository = colon > slash ? reference.slice(0, colon) : reference;
      return line.startsWith(`${repository}@sha256:`);
    })
    ?.split("@")[1];
  if (config.requirePublishedDigest && !pushedDigest)
    throw new Error(`no published digest found for ${config.image}`);
  const validation = parseJson(
    await readFile(config.validationFile, "utf8"),
    "container validation",
  );
  const result = {
    image: config.image,
    digest: pushedDigest || "local",
    version: config.version,
    distribution: config.distribution,
    package_format: config.packageFormat,
    package_candidate: config.packageCandidate,
    package_provenance: config.packageProvenance,
    base_image: config.baseImage,
    base_image_digest: config.baseImageDigest,
    source_ref: config.sourceRef,
    source_commit: config.sourceCommit,
    packaging_commit: config.packagingCommit,
    rpm_repo_url: config.rpmRepoUrl,
    rpm_metadata_sha256: config.rpmMetadataSha256,
    deb_repo_url: config.debRepoUrl,
    build_log: config.buildLog,
    container_validation: validation,
    workflow: null,
    run_id: config.conductorRunId,
  };
  await writeAtomic(config.outputFile, result);
  await rm(publicationStateFile(config), { force: true });
  console.log(JSON.stringify(result));
}

export async function reconcilePendingImagePublication(
  file,
  commandRunner = defaultRun,
) {
  const pending = parseJson(
    await readFile(file, "utf8"),
    `pending image publication ${file}`,
  );
  if (pending.status !== "pending")
    throw new Error(`unsupported pending publication state: ${pending.status}`);
  await writeLocalImageResult({
    image: pending.image,
    aliases: pending.aliases || [],
    version: pending.version,
    distribution: pending.distribution,
    packageFormat: pending.package_format,
    packageCandidate: pending.package_candidate,
    packageProvenance: pending.package_provenance,
    baseImage: pending.base_image,
    baseImageDigest: pending.base_image_digest,
    sourceRef: pending.source_ref,
    sourceCommit: pending.source_commit,
    packagingCommit: pending.packaging_commit,
    rpmRepoUrl: pending.rpm_repo_url,
    rpmMetadataSha256: pending.rpm_metadata_sha256,
    debRepoUrl: pending.deb_repo_url,
    buildLog: pending.build_log,
    validationFile: pending.validation_file,
    runtime: pending.runtime || "docker",
    conductorRunId: pending.conductor_run_id,
    outputFile: pending.output_file,
    publicationStateFile: file,
    requirePublishedDigest: true,
    run: commandRunner,
  });
  return parseJson(
    await readFile(pending.output_file, "utf8"),
    `reconciled image result ${pending.output_file}`,
  );
}
