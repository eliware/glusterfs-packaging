# GlusterFS packaging pipeline

This document is the source of truth for the automated release pipeline in
`eliware/glusterfs-packaging`. It describes the current design only.

All other project documentation is explanatory or operational guidance and
must defer to this document when describing pipeline stages, ownership,
parallelism, checkpoints, publication, or recovery behavior. Changes to the
pipeline implementation must update this document in the same change.

## Goal

The local `gluster-packaging` conductor coordinates reproducible package and
container releases for six independent lanes:

| Lane             | Package | Target                                                    |
| ---------------- | ------- | --------------------------------------------------------- |
| `epel10-stable`  | RPM     | CentOS Stream 10 / EL10-compatible RPM repository         |
| `epel10-rolling` | RPM     | CentOS Stream 10 / EL10-compatible RPM preview repository |
| `debian-stable`  | DEB     | Debian 12 (bookworm) APT repository                       |
| `debian-rolling` | DEB     | Debian 12 (bookworm) APT preview repository               |
| `ubuntu-stable`  | DEB     | Ubuntu 24.04 (noble) APT repository                       |
| `ubuntu-rolling` | DEB     | Ubuntu 24.04 (noble) APT preview repository               |

RPM and DEB package builders are CPU-heavy and run on GitHub Actions through
self-hosted ARC runner scale sets. Package Smoke-1 runs inside the builder
job. Smoke-2 and all final image work run on this machine through Docker. No
package-smoke or image-publish GitHub workflow is part of the pipeline.

## Components

### Conductor

The conductor is `scripts/conductor.mjs`, normally launched by the local
`gluster-packaging.timer` through `gluster-packaging.service`. The systemd
service runs `scripts/conductor-service.mjs`, which performs one dry-run
preflight and starts `conductor.mjs --wet-run` only if that preflight exits
successfully. A dry-run or wet-run failure sends the configured Discord alert;
the wet run is never started after a failed preflight. The direct
`conductor.mjs` entrypoint remains available for explicit `--dry-run` or
`--wet-run` operation, but bypasses this systemd gate. The conductor is the
only process allowed to update checkpoints, release metadata, catalogs,
provenance, and validation records.

The conductor owns one global lock and one serialized publication queue. Build
lanes may run concurrently; metadata publication is serialized so two lanes
cannot overwrite `catalog.json` or release metadata at the same time.

Local container work has two additional filesystem-backed locks under the
conductor state directory:

- `local-smoke-2.lock` permits only one local package Smoke-2 container at a
  time;
- `local-image-build.lock` permits only one local image build/smoke/publish
  operation at a time.

The image lock serializes local image operations within one conductor process;
the publication queue serializes metadata writes. Both recover stale ownership
after a crashed process and are released in `finally`
blocks. They protect the development VM from concurrent Docker, package,
mount, and image workloads.

It also owns upstream checks, base-image digest resolution, rate-limit handling,
checkpoint decisions, local Docker Smoke-2 and image tests, package signing,
repository publication, local GHCR publication, provenance, catalogs, backups,
and notifications.

Before any build starts, the conductor checks Docker Hub access when an
unpinned Docker Hub base reference must be resolved and requires
both quota headers plus a safety floor of 24 remaining pulls. Missing headers,
network failures, and Docker Hub 5xx responses are retried four times with
backoff; a low or exhausted quota defers the run without starting work. The
defaults can be tuned outside the repository with
`CONDUCTOR_DOCKERHUB_MIN_REMAINING`, `CONDUCTOR_DOCKERHUB_ATTEMPTS`, and
`CONDUCTOR_DOCKERHUB_BACKOFF_MS`.

The canonical conductor checkpoint state is published at
`metadata/conductor-state.json` under the configured publication root. The
local state directory is used only for the global lock, transient status files,
and local build coordination. This keeps the checkpoint state in the same
backup generation as the repository artifacts.

### Module ownership map

The entrypoint remains the coordinator; focused modules own the following
areas:

| Area                                                    | Module(s)                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| CLI, runtime configuration, and stage locks             | `conductor-cli.mjs`, `conductor-config.mjs`, `conductor-stage-lock.mjs`                                                    |
| Lane definitions and status output                      | `lane-config.mjs`, `conductor-status.mjs`                                                                                  |
| Package build, readiness, and Smoke-2                   | `build-rpms.mjs`, `build-debs.mjs`, `candidate-readiness.mjs`, `package-lane.mjs`, `package-validation.mjs`                |
| Local image planning, build, smoke, labels, and results | `conductor-image-plan.mjs`, `local-image-build.mjs`, `local-image-smoke.mjs`, `image-labels.mjs`, `local-image-result.mjs` |
| Checkpoints and final validation                        | `image-checkpoint.mjs`, `conductor-final-validation.mjs`                                                                   |
| Provenance and release manifests                        | `write-provenance.mjs`, `write-package-provenance.mjs`, `write-release-manifest.mjs`, `verify-provenance.mjs`              |
| RPM/DEB repository generation and signing               | `make-repository.mjs`, `make-apt-repository.mjs`, `sign-repository.mjs`, `sign-apt-repositories.mjs`                       |
| Publication paths and publication locking               | `publication-paths.mjs`, `publication-lock.mjs`, `publish-package-candidate.mjs`, `publish-image.mjs`                      |
| Catalog and repository indexes                          | `catalog-repositories.mjs`, `write-catalog.mjs`, `rebuild-catalog.mjs`, `generate-repository-index.mjs`                    |
| Release reports and notifications                       | `release-report.mjs`, `discord-notifier.mjs`                                                                               |
| External workflow and quota access                      | `dispatch-workflow.mjs`, `github-quota.mjs`, `docker-hub-quota.mjs`, `docker-hub-auth.mjs`                                 |
| Docker Hub preflight retries and safety floor           | `docker-hub-preflight.mjs`                                                                                                 |
| Metadata serialization and validation                   | `metadata-io.mjs`, `metadata-version.mjs`, `serialization.mjs`, `validation-schema.mjs`                                    |

`conductor.mjs` sequences these modules and remains responsible for the
cross-stage decisions, global lock, checkpoint resume behavior, and final
run lifecycle. New behavior should be added to the narrowest owning module;
the entrypoint should only coordinate it.

### GitHub Actions and ARC

Only these package-builder workflows are dispatched by the conductor:

- `.github/workflows/rpm-package-build.yml`
- `.github/workflows/deb-package-build.yml`

The workflows use the appropriate ARC scale set:

- `eliware-rpm-builder` for the RPM lane;
- `eliware-deb-builder` for Debian DEB lanes;
- `eliware-ubuntu-builder` for Ubuntu DEB lanes.

Each package builder mounts the persistent workspace PVC and a worker-local
RAM-backed scratch PVC. It copies its lane ccache into RAM before compiling,
builds with the configured parallel job count, and synchronizes ccache and
candidate output back to persistent storage before cleanup. A failed job also
cleans its RAM workspace.

The builder performs Smoke-1 inside its own builder job. Smoke-1 installs the
generated packages, starts `glusterd`, creates and mounts a temporary volume,
performs a file create/read/update/delete lifecycle, removes the volume, and
shuts the service down. The candidate is not eligible for the next phase until
Smoke-1 and candidate-readiness checks pass.

The builder-base-image workflows are maintenance workflows for producing ARC
toolchain images. They are not dispatched for each package release.

## End-to-end flow

### 1. Acquire the conductor lock

The service acquires the global lock. If another conductor is active, the new
run exits without changing metadata or publishing anything.

### 2. Verify every external input

Before scheduling work, the conductor verifies:

- the latest stable GlusterFS release tag and commit;
- the current GlusterFS `devel` commit;
- supported CentOS Stream, Rocky, Alma, Oracle, Debian, and Ubuntu base-image
  references;
- GitHub API access and Actions dispatch availability;
- Docker Hub quota when an unpinned base reference must be resolved;
- local prerequisites are checked by the individual build, signing, and
  publication stages as they are needed.

Docker Hub access is authenticated when required. The conductor reads the Docker CLI
credential at `/root/.docker/config.json` (or `DOCKER_CONFIG`) and uses it for
the quota-token request and Skopeo digest inspection; the Docker CLI uses the
same credential for image pulls. The Debian and Ubuntu builder-image
workflows log in before their Docker Hub base-image pulls using the GitHub
secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`. The token needs read-only
access. A missing credential is a preflight failure rather than an anonymous
pull. Digest-pinned references avoid the quota-check request, but their image
layers are still pulled with the same authenticated Docker credentials during
an actual build.

Transient network, DNS, TLS, API, and rate-limit failures are retried with
bounded backoff. If any required source cannot be verified, the conductor
stops before scheduling builds and does not alter release metadata.

### 3. Select lanes and evaluate checkpoints

If every package and image checkpoint is current, the conductor exits as a
successful no-op. It creates only transient status state, then removes it; it
does not persist a run record, rewrite metadata, generate release artifacts,
commit, push, or run a backup. It logs a concise `NOOP` result and sends the
configured Discord notification.

Stable and rolling lanes are evaluated independently. A package build is
skipped only when its package checkpoint matches the source commit,
release/channel, package format, distribution, suite, and version; has
successful Smoke-1 and Smoke-2 records; and has verified package provenance,
repository metadata, and signatures.

An image build is evaluated separately. A valid package checkpoint never marks
an image complete. An image is skipped only when its own checkpoint matches the
source commit, base-image digest, package provenance, image tag, container
validation, immutable digest, and a provenance document that passes
`verify-provenance.mjs`; merely finding a provenance file is insufficient.

This separation lets a rerun skip valid package work and continue with missing
Smoke-2, publication, provenance, or image work.

### 4. Dispatch package builders

For every lane whose package checkpoint is incomplete, the conductor dispatches
the matching package-builder workflow. The six lanes are independent and may
run concurrently, subject to ARC capacity and worker placement.

The builder writes its log and candidate to the lane workspace. The candidate
contains generated packages, repository metadata, Smoke-1 validation, a
candidate result, and a readiness manifest. The conductor waits for the
workflow result and verifies the candidate files and manifest before continuing.

### 5. Run Smoke-2 locally

For every package target that lacks a passing Smoke-2 record, the conductor
runs Docker locally:

- RPM targets use `tests/smoke-install.mjs`;
- DEB targets use `tests/smoke-install-deb.mjs`.

Each test waits for the `local-smoke-2.lock`, then starts a clean privileged
CentOS-family, Debian, or Ubuntu container, mounts the candidate directory
read-only, installs the candidate packages, runs the GlusterFS lifecycle test,
and writes a validation record. The conductor may schedule the target checks
as independent promises, but the lock intentionally executes them one at a
time across all lanes to protect the development VM from CPU, memory, and
Docker contention. These tests do not use Docker-in-Docker, ARC sidecars, or a
PVC-mounted Docker daemon.

The conductor saves each result as Smoke-2 and updates the staged
pre-publication checkpoint after each passing target. A failed target leaves
the candidate available for a diagnostic rerun and prevents publication for
that lane.

### 6. Sign and publish packages

After Smoke-1 and all required Smoke-2 targets pass, the conductor:

1. writes and verifies package provenance;
2. signs every RPM, including `glusterfs-selinux`, and repository metadata;
3. signs the DEB repository metadata as configured;
4. publishes the candidate into the stable or rolling repository path;
5. verifies repository metadata, checksums, signatures, and provenance;
6. records the package checkpoint after the queued publication completes.

A successful package checkpoint is independent of image completion. Packages
remain published if a later image build fails.

### 7. Build final images locally

For each package format, the conductor builds supported runtime images in
parallel with the local Docker engine:

| Package    | Images                                                                      |
| ---------- | --------------------------------------------------------------------------- |
| RPM        | `centos10-gluster`, `rocky10-gluster`, `alma10-gluster`, `oracle10-gluster` |
| Debian DEB | `debian12-gluster`                                                          |
| Ubuntu DEB | `ubuntu24-gluster`                                                          |

The conductor acquires `local-image-build.lock` around the child image
build/publish operation. Image targets are scheduled independently, but this
lock intentionally serializes the Docker-heavy operation on the development
VM; provenance and catalog reconciliation happen in the coordinator outside
that lock. The existing
Dockerfiles under `containers/` are used. Each build receives an immutable
base-image reference, the URL of the already-published signed package
repository, package provenance, source commit, packaging commit, and
repository metadata digest. The Dockerfiles fetch the repository key and
metadata over HTTPS and install through the normal signed DNF or APT
configuration; package files are not copied into the image build context.
The local helper is `scripts/build-publish-image-local.mjs`.

### 8. Run final container Smoke-3 locally

Before publication, the conductor runs the final image smoke test:

- RPM images use `tests/container-smoke.mjs`;
- Debian-family images use `tests/container-smoke-deb.mjs`.

The image test verifies installed package state, CLI availability, GlusterFS
daemon startup, temporary volume creation and mount, file lifecycle, volume
cleanup, and daemon shutdown. `scripts/image-labels.mjs` verifies immutable
provenance labels and adds the label check to the validation record.

### 9. Publish images directly to GHCR

Only after Smoke-3 and label validation pass does the local conductor publish
the image with `scripts/publish-image.mjs`. It records the immutable GHCR
digest and pushes stable aliases when applicable. The local process uses the
configured GHCR token or `gh auth token`; no GitHub image-publish workflow is
needed.

### 10. Write image provenance and catalog data

The conductor writes image provenance linking the package provenance, package
repository and metadata digest, source ref and commit, packaging commit,
immutable base-image digest, final GHCR image reference and digest, and
Smoke-3 and image-label validation.

It then updates `catalog.json`, repository indexes, release manifests, and run
metadata. Each file is replaced atomically, but the group is not one
cross-file transaction. The publication queue ensures each update is
based on the newest catalog state.

### 11. Finalize and publish the repository snapshot

The conductor records the final run and per-lane checkpoints in
`metadata/conductor-state.json`, sends the configured completion or failure
notification, and only then runs the configured repository snapshot script.
The default deployment script commits and pushes the repository, capturing the
repository artifacts, provenance, catalog, release report, and matching
conductor state in Git. Temporary candidates and logs are removed only after
the related provenance and publication work is complete. Persistent ccache
directories are retained unless the reset command explicitly enables cache
removal.

Conductor output is intentionally human-readable and concise. The machine
result is retained in the canonical state and provenance records rather than
dumped into the systemd journal. Periodic ten-second status reports are off by
default; the deployed service enables them with `CONDUCTOR_STATUS_REPORTS=1`
while runs are being observed manually.

The daily timer invokes the same service wrapper as a manual service start:

```sh
systemctl start gluster-packaging.service
systemctl status gluster-packaging.service
```

Do not run a separate dry-run immediately before starting the service; the
wrapper performs that preflight itself. `scripts/reset-default.mjs --force`
is the guarded reset operation and preserves lane ccaches unless
`RESET_CLEAR_CCACHE=1` is explicitly set.

## Failure and resume behavior

Failures are recorded against the affected lane and stage. A failure in one
lane does not invalidate a successful, independently published lane. The next
conductor run reuses valid package and image checkpoints and resumes at the
first incomplete stage.

```text
package build + Smoke-1
        ↓
local Smoke-2 for every target
        ↓
sign and publish package repository
        ↓
local image build
        ↓
local Smoke-3 + label validation
        ↓
publish image to GHCR
        ↓
provenance, catalog, checkpoint, backup
```

No stage assumes that a later stage succeeded. A package checkpoint does not
imply an image checkpoint, and an image build does not become published until
its local smoke test passes.

## Workspaces and artifacts

The persistent build workspace is the lane-specific directory under
the configured workspace root. It contains source/build state, ccache,
candidate output, and retained logs needed for diagnostics. RAM-backed scratch
space is temporary and is always removed by the builder on success, failure,
or termination.

The published repository is mounted at the configured publish root and serves
RPM, APT, metadata, provenance, validation, and release files. Container image
layers are stored only in GHCR; they are not copied to the repository volume.

## Workflow inventory

### Retained and used by the conductor

- `rpm-package-build.yml` — CPU-heavy RPM candidate build and Smoke-1.
- `deb-package-build.yml` — CPU-heavy Debian/Ubuntu DEB candidate build and
  Smoke-1.

### Retained maintenance workflows

- `rpm-builder-image.yml` — RPM ARC toolchain image.
- `debian12-builder-image.yml` — Debian ARC toolchain image.
- `ubuntu24-builder-image.yml` — Ubuntu ARC toolchain image.

### Removed from the release pipeline

The following categories are obsolete and must not be dispatched:

- `rpm-package-smoke.yml` and `deb-package-smoke.yml`;
- per-OS image-publish wrappers;
- the reusable Docker-in-Docker image-publish workflow;
- any ARC image-builder scale set, DIND sidecar, or image-build PVC setup.

The local conductor is now the image builder, image smoke tester, and GHCR
publisher.
