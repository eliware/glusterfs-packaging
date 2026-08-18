# AGENTS.md

## Scope

This repository contains reproducible GlusterFS package builds, release
metadata, a repository HTTP application, and publication tooling. Milestone
one covers the latest stable GlusterFS release and rolling previews for the
supported RPM and DEB distributions.

## Rules

- Keep source, build configuration, ESM scripts, tests, and templates in Git.
- Never commit RPMs, repository metadata, signing keys, credentials, or build
  workspace state.
- Build stable packages only from the latest non-prerelease upstream release
  tag discovered by the release watcher.
- Keep development and patched builds separate from the stable channel.
- Never bypass package, signature, repository, or image smoke-test gates.
- Record source checksums, repository metadata hashes, container image digests,
  patches, and test results.
- Publish runtime OCI images to GHCR; do not add a self-hosted OCI registry
  dependency.
- Use stable tags such as `ghcr.io/eliware/centos10-gluster:11.2` and rolling
  tags such as `ghcr.io/eliware/centos10-gluster:2026.08.15-abcdef123456`.
  Stable aliases are the Gluster version and `latest`; `rolling` identifies
  the latest rolling image. Deployments should use catalog-recorded digests.
- Build, Smoke-3 test, label-check, and publish final images locally through
  the conductor after their package repository passes its gates.
- Keep the incremental build workspace separate from immutable release output.
- Keep packaging storage distinct from unrelated application storage. See
  [Storage boundaries](docs/CLUSTER-BOUNDARIES.md) for the ownership rules;
  deployment-specific mount details remain private.
- The conductor owns six independent package lanes under the configured
  workspace root: `epel10-stable`,
  `epel10-rolling`, `debian-stable`, `debian-rolling`, `ubuntu-stable`, and
  `ubuntu-rolling`. Never reuse one lane's source, dependency state, or output
  directory for another lane.
- Debian and Ubuntu package workflows build one distribution per run. Do not
  run `apt` or `dpkg` dependency installation concurrently in the same runner
  environment.
- Keep at most 30 rolling preview repositories in the published repository.
- Treat all signing material and registry credentials as external secret
  configuration; never place them in Git or an image build context.
- Keep the HTTP server source in `src/` and the public templates in
  `templates/`. Do not introduce a dependency on another application or
  deployment repository.
- Keep Node project metadata and the lockfile at the repository root. Do not
  commit the root `node_modules/` directory.

## Validation

```sh
node --check src/be/server.mjs
npm test
npm run lint
docker build -f containers/centos10-builder.Dockerfile .
node scripts/build-workspace.mjs
node scripts/make-repository.mjs
node tests/smoke-install.mjs
```

Package builder workflows run their package lifecycle smoke test directly in
their privileged runner after installing the generated packages. The local
conductor runs package Smoke-2 and final image Smoke-3 locally, then publishes
images directly to GHCR and writes the catalog and provenance records.
