# [![eliware.org](https://eliware.org/logos/brand.png)](https://eliware.org)

## GlusterFS Packaging

Reproducible GlusterFS package builds, signed repositories, runtime images, and
provenance records maintained by Eliware.

[![license](https://img.shields.io/github/license/eliware/glusterfs-packaging.svg)](LICENSE)
[![build status](https://github.com/eliware/glusterfs-packaging/actions/workflows/ci.yml/badge.svg)](https://github.com/eliware/glusterfs-packaging/actions/workflows/ci.yml)

The public repository and release catalog are available at
[glusterfs.eliware.org](https://glusterfs.eliware.org/).

## Current status

This project has moved beyond its initial repository milestone. It now
operates as a complete release system with:

- Stable and rolling GlusterFS RPM releases for EL10-compatible systems.
- Native Debian and Ubuntu DEB repositories for Debian 12 and Ubuntu 24.04.
- Signed repository metadata, checksums, provenance, release manifests, and
  immutable publication records.
- Runtime container images for the supported RPM and DEB distributions,
  published to [GHCR](https://github.com/orgs/eliware/packages).
- Independent package and image checkpoints so successful work is reusable.
- Package Smoke-1, package Smoke-2, and container Smoke-3 validation gates.
- Automated rolling previews with bounded retention.
- A separate repository HTTP service consumes the published repositories and
  metadata; its source is maintained in [`eliware/gluster-http`](https://github.com/eliware/gluster-http).
- Discord notifications for conductor stages, checkpoint completion, and
  failures.
- Versioned metadata contracts tied to `package.json`, with ordered migration
  modules for future metadata-shape changes.

## What this repository produces

### Package repositories

RPM repositories are published under:

```text
https://glusterfs.eliware.org/el10/x86_64/stable/
https://glusterfs.eliware.org/el10/x86_64/previews/<preview-id>/
```

APT repositories are published under distribution-specific paths:

```text
https://glusterfs.eliware.org/debian/bookworm/amd64/stable/
https://glusterfs.eliware.org/ubuntu/noble/amd64/stable/
```

RPM and DEB packages are built independently because dependency resolution,
toolchains, package formats, and repository metadata differ by target.

### Container images

Runtime images are published to GHCR under distribution-specific repositories.
Stable tags identify the GlusterFS release; rolling tags identify the preview
date and source commit. Every published image also receives an immutable
digest recorded in the catalog and provenance records.

Consumers should use the digest recorded by the catalog for reproducible
deployments rather than relying on mutable convenience tags.

The images are minimal GlusterFS runtime bases. They do not contain a consumer
application; downstream projects add their own application and configuration.

## Release pipeline

The local conductor is the single release coordinator. It verifies upstream
inputs and external services, evaluates independent package and image
checkpoints, dispatches only the incomplete package lanes, and serializes
publication metadata.

The current package lanes are:

| Lane             | Target                                    |
| ---------------- | ----------------------------------------- |
| `epel10-stable`  | EL10-compatible RPM repository            |
| `epel10-rolling` | EL10-compatible RPM preview repository    |
| `debian-stable`  | Debian 12 bookworm DEB repository         |
| `debian-rolling` | Debian 12 bookworm DEB preview repository |
| `ubuntu-stable`  | Ubuntu 24.04 noble DEB repository         |
| `ubuntu-rolling` | Ubuntu 24.04 noble DEB preview repository |

Each package lane builds its candidate, runs Smoke-1 in the builder, and
returns its artifacts and evidence. The conductor then runs serialized local
Smoke-2 against the candidate, signs and publishes passing repositories, builds
the corresponding runtime images, runs Smoke-3, publishes passing images to
GHCR, and records the final catalog/checkpoint/provenance state.

Package and image completion are intentionally independent. A valid package
checkpoint allows later runs to skip compilation while still completing any
missing publication, provenance, or image work.

The authoritative stage-by-stage description is
[`docs/PIPELINE.md`](docs/PIPELINE.md). The shorter operational overview is
[`AUTOMATION.md`](AUTOMATION.md).

Deferred engineering work and future-release improvements are tracked in
[`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).

## Metadata and provenance

Every persistent metadata document carries a `metadata_version` derived from
the root `package.json` version. When a metadata shape changes, a migration is
added under [`migrations/`](migrations/) using the target package version.
Readers apply migrations in order, atomically persist successful changes, and
reject missing, legacy, unknown, or newer metadata versions.

Provenance records link package candidates to source commits, package
validation, repository metadata, image inputs, image digests, container
validation, and signed release manifests. The public catalog exposes hashes
and public URLs rather than private environment values or local filesystem
paths.

See [`docs/METADATA.md`](docs/METADATA.md) and
[`docs/logs.md`](docs/logs.md) for the evidence model.

## Repository website integration

The separate `eliware/gluster-http` repository serves the published package
repositories, release metadata, provenance records, and shared-storage blog
posts. This project remains the source of truth for the package, image,
metadata, and provenance contracts that the HTTP service adapts.

## Development

### Requirements

- Node.js 26 or newer and npm.
- Git, Docker, GPG, native RPM/DEB tooling, and the relevant build container
  tools for package development.
- Chromium/Chrome is optional for local release-card rendering.

Install dependencies and run the core checks:

```sh
npm install
npm test
npm run test:gaps
npm run lint
npm run check
```

Generated build output, coverage, local credentials, and runtime state are
ignored by Git. Browser screenshots and Lighthouse checks belong to the HTTP
service repository.

### Local conductor modes

The conductor requires an explicit mode:

```sh
npm run conductor -- --help
npm run conductor -- --dry-run
npm run conductor -- --wet-run
```

The systemd service performs its own dry-run preflight before a wet run. It
requires deployment configuration for workspace, publication, backup, signing,
registry, and notification settings. Those values belong in private operator
configuration, never in Git.

## Security boundaries

- Never commit private keys, passphrases, registry credentials, webhook URLs,
  kubeconfigs, host inventories, volume IDs, or concrete private network
  details.
- Signing and registry credentials are supplied at runtime through external
  secret configuration.
- Deployment-specific storage, networking, DNS, Kubernetes, and backup
  settings remain outside this repository.
- Published records contain hashes and public references, not secret
  environment dumps or private filesystem paths.
- Do not bypass package, repository, provenance, or image smoke-test gates.

## Project layout

```text
build-config/       target and distribution inputs
containers/         pinned builder and runtime image definitions
migrations/         versioned metadata migrations
scripts/            conductor, build, validation, signing, and publication code
tests/               unit, integration, smoke, and pipeline checks
docs/                authoritative pipeline and operational documentation
releases/            tracked release records
```

## Support

For questions, bug reports, or contribution discussion, open an issue in the
[GitHub repository](https://github.com/eliware/glusterfs-packaging) or join the
[Eliware Discord community](https://discord.gg/M6aTR9eTwN).

## Links

- [Project website](https://glusterfs.eliware.org/)
- [Eliware home page](https://eliware.org/)
- [GitHub repository](https://github.com/eliware/glusterfs-packaging)
- [Eliware GitHub organization](https://github.com/eliware)
- [Eli Sterling on GitHub](https://github.com/eli-sterling)
- [GHCR container packages](https://github.com/orgs/eliware/packages)
- [Official GlusterFS project](https://www.gluster.org/)
- [GlusterFS documentation](https://docs.gluster.org/)
- [GlusterFS source repository](https://github.com/gluster/glusterfs)
- [GlusterFS issue tracker](https://github.com/gluster/glusterfs/issues)
- [Eliware Discord](https://discord.gg/M6aTR9eTwN)
