# Automated build and release

This file is a short operational overview. The authoritative description of
the pipeline, stages, checkpoints, locks, artifacts, and recovery behavior is
[`docs/PIPELINE.md`](docs/PIPELINE.md). Update that document whenever the
implementation changes.

## Orchestrator

The local `gluster-packaging` conductor is `scripts/conductor.mjs`, normally
started by `gluster-packaging.service` and its daily systemd timer. The service
actually invokes `scripts/conductor-service.mjs`: it runs a dry-run preflight
first and invokes the wet run only after that preflight succeeds. Either phase
failure sends the configured Discord notification. The conductor owns the
global run lock and is the only process that updates checkpoints, validation
metadata, catalogs, provenance, and release manifests.

The conductor verifies upstream GlusterFS revisions, supported base-image
digests, GitHub access, quotas, signing configuration, Docker, and repository
storage before dispatching work. If a required input cannot be verified, it
stops without scheduling a build or changing release metadata.

## Package lanes

The conductor independently evaluates and, when needed, dispatches six package
lanes:

| Lane             | Package target                                  | Builder                 |
| ---------------- | ----------------------------------------------- | ----------------------- |
| `epel10-stable`  | CentOS Stream 10 / EL10-compatible RPMs         | `rpm-package-build.yml` |
| `epel10-rolling` | CentOS Stream 10 / EL10-compatible RPM previews | `rpm-package-build.yml` |
| `debian-stable`  | Debian 12 bookworm DEBs                         | `deb-package-build.yml` |
| `debian-rolling` | Debian 12 bookworm DEB previews                 | `deb-package-build.yml` |
| `ubuntu-stable`  | Ubuntu 24.04 noble DEBs                         | `deb-package-build.yml` |
| `ubuntu-rolling` | Ubuntu 24.04 noble DEB previews                 | `deb-package-build.yml` |

The CPU-heavy package builders run through GitHub Actions on the appropriate
self-hosted ARC scale set. Each builder uses its lane workspace and RAM-backed
scratch space, preserves its lane ccache, builds the exact requested upstream
commit, and runs package Smoke-1 locally inside the builder. A successful
candidate is copied to the shared workspace with its result and log records.

Package checkpoints are independent from image checkpoints. A valid package
checkpoint allows later runs to skip package compilation while still checking
for missing publication, provenance, validation, or image work.

## Release stages

For each incomplete lane, the conductor follows this sequence:

1. Dispatch and monitor the package builder.
2. Verify the candidate and its Smoke-1 result.
3. Run package Smoke-2 locally in Docker against the candidate.
4. Sign and publish the passing RPM or APT repository.
5. Build the matching runtime image locally.
6. Run image Smoke-3 and verify immutable labels.
7. Publish the passing image directly to GHCR.
8. Write package/image provenance, validation records, catalog data, and
   checkpoints.

Smoke-2 is serialized by a local lock to protect the development machine.
Image build, Smoke-3, and publication are likewise serialized by a local image
lock. Independent lanes may still be planned and package builders may run
concurrently on ARC. A failure affects only the affected lane; successful lanes
may complete and publish independently.

Final images are built by `scripts/build-publish-image-local.mjs`. The local
flow installs from the signed published repository, runs the distribution-
specific lifecycle test, records the immutable GHCR digest, and updates the
catalog. No final-image GitHub workflow, Docker-in-Docker sidecar, or image
builder ARC runner is required.

## State and backups

Conductor state is stored below the configured state root. Persistent lane
workspaces and retained build logs are under the configured workspace root.
Published repositories and release metadata are under the configured
repository publication root.

After a non-dry-run completion that changes published state, the configured
repository script commits and pushes the publication repository. Git is the
source of truth for published packages, metadata, provenance, and release
records; no legacy `/repo-backups` step is part of the conductor path.

Use a direct dry run to inspect discovery, checkpoint decisions, and planned
lane transitions without dispatching workflows or publishing artifacts:

```sh
cd /opt/gluster-packaging
node scripts/conductor.mjs --dry-run
```

For a normal release, start the service instead. It performs its own dry-run
gate, so a separate dry run is unnecessary:

```sh
systemctl start gluster-packaging.service
```

For the complete workflow, artifact layout, validation requirements, and
failure/resume behavior, use [`docs/PIPELINE.md`](docs/PIPELINE.md).
