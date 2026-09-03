#!/usr/bin/env node
import path from "node:path";
import { exists, env, repoRoot, runInteractive } from "./lib.mjs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import {
  assertValidationRecord,
  markPublicationVerified,
} from "./validation-schema.mjs";

const mode = process.argv[2];
const candidate = process.argv[3];
const candidateRoot = process.argv[4];
if (!mode || !candidate || !candidateRoot)
  throw new Error(
    "usage: publish-package-candidate.mjs stable|preview ID CANDIDATE_DIR",
  );
const debugLog = env("PUBLICATION_DEBUG_LOG", "");
const diagnostic = async (message) => {
  if (!debugLog) return;
  await appendFile(
    debugLog,
    `[publish-package-candidate] ${new Date().toISOString()} ${message}\n`,
  );
};
await diagnostic(`start mode=${mode} candidate=${candidate} root=${candidateRoot}`);
const rpmDir = path.join(candidateRoot, "rpm");
const debRoot = path.join(candidateRoot, "deb");
const hasRpm = await exists(rpmDir);
const hasDeb = await exists(debRoot);
if (!hasRpm && !hasDeb)
  throw new Error(`candidate has no packages: ${candidateRoot}`);
await diagnostic(`inputs rpm=${hasRpm ? rpmDir : "none"} deb=${hasDeb ? debRoot : "none"}`);
let result = {};
try {
  result = JSON.parse(
    await readFile(path.join(candidateRoot, "result.json"), "utf8"),
  );
} catch {}
const packageFormat = result.package_format || (hasRpm ? "rpm" : "deb");
if (hasRpm) {
  await diagnostic(`signing RPM repository ${rpmDir}`);
  await runInteractive(
    "node",
    [
      path.join(repoRoot, "scripts/sign-repository.mjs"),
      rpmDir,
      path.join(candidateRoot, "rpm-stable"),
    ],
    { env: process.env },
  );
  await diagnostic(`RPM repository signing complete ${path.join(candidateRoot, "rpm-stable")}`);
}
if (hasDeb) {
  await diagnostic(`signing APT repository ${debRoot}`);
  await runInteractive(
    "node",
    [path.join(repoRoot, "scripts/sign-apt-repositories.mjs"), debRoot],
    {
      env: {
        ...process.env,
        RELEASE_VERSION: result.version || env("RELEASE_VERSION", "stable"),
      },
    },
  );
  await diagnostic("APT repository signing complete");
}
const packageRoot = hasRpm
  ? rpmDir
  : path.join(
      debRoot,
      result.distribution,
      result.suite,
      "amd64",
      result.version,
    );
const validationFile = path.join(candidateRoot, "validation.json");
if (await exists(validationFile)) {
  const validation = JSON.parse(await readFile(validationFile, "utf8"));
  assertValidationRecord(validation, {
    coreField: "package_core",
    label: `${packageFormat} package`,
  });
  const verified = markPublicationVerified(
    validation,
    "candidate package metadata, checksums, and signatures verified",
  );
  await writeFile(validationFile, `${JSON.stringify(verified, null, 2)}\n`);
  if (result.validation) result.validation = verified;
  await writeFile(
    path.join(candidateRoot, ".provenance-record.json"),
    `${JSON.stringify(
      {
        ...JSON.parse(
          await readFile(
            path.join(candidateRoot, ".provenance-record.json"),
            "utf8",
          ),
        ),
        validation: verified,
      },
      null,
      2,
    )}\n`,
  );
}
const provenanceArgs = [
  "node",
  [
    path.join(repoRoot, "scripts/write-package-provenance.mjs"),
    "--output-dir",
    candidateRoot,
    "--package-root",
    packageRoot,
    "--record-json",
    path.join(candidateRoot, ".provenance-record.json"),
    "--format",
    packageFormat,
  ],
];
if (result.build_log && (await exists(result.build_log)))
  provenanceArgs[1].push("--asset", "build-log", result.build_log);
const validationAsset = path.join(candidateRoot, "validation.json");
if (await exists(validationAsset))
  provenanceArgs[1].push("--asset", "package-validation", validationAsset);
const smoke2Asset = path.join(candidateRoot, "smoke-2.json");
if (await exists(smoke2Asset))
  provenanceArgs[1].push("--asset", "package-smoke-2", smoke2Asset);
await diagnostic(`writing package provenance packageRoot=${packageRoot}`);
await runInteractive(provenanceArgs[0], provenanceArgs[1], {
  env: process.env,
});
await runInteractive("node", [
  path.join(repoRoot, "scripts/verify-provenance.mjs"),
  candidateRoot,
  "--tree-root",
  packageRoot,
]);
await diagnostic("provenance verification complete");
const publishedCandidate = mode === "preview" ? candidate : "stable";
const provenanceUrl =
  packageFormat === "rpm"
    ? `/el10/x86_64/${mode === "preview" ? `previews/${publishedCandidate}` : "stable"}/provenance.json`
    : `/${result.distribution}/${result.suite}/amd64/${mode === "preview" ? `previews/${publishedCandidate}` : "stable"}/provenance.json`;
await diagnostic(`publishing candidate to repository mode=${mode}`);
await runInteractive(
  "node",
  [
    path.join(repoRoot, "scripts/publish-candidate.mjs"),
    mode,
    candidate,
    hasRpm ? rpmDir : "-",
  ],
  {
    env: {
      ...process.env,
      RELEASE_VERSION: result.version || env("RELEASE_VERSION", "stable"),
      VALIDATION_FILE: path.join(candidateRoot, "validation.json"),
      DEB_ROOT: hasDeb ? debRoot : "",
      PACKAGE_ONLY: "1",
      RPM_ONLY: hasRpm ? "1" : "0",
      PACKAGE_FORMAT: packageFormat,
      PACKAGE_DISTRIBUTION: result.distribution || "centos-stream",
      PACKAGE_SUITE: result.suite || "",
      PACKAGE_VERSION: result.package_version || result.version || "stable",
      SOURCE_REF: result.source_ref || "unknown",
      SOURCE_COMMIT: result.source_commit || "unknown",
      PROVENANCE_ROOT: candidateRoot,
      PROVENANCE_URL: provenanceUrl,
    },
  },
);
await diagnostic("repository publication complete");
console.log(`Published ${mode} package candidate ${candidate}`);
