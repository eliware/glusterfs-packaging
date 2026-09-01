# Release notes

## v0.1.0 — Initial release

The first release of `glusterfs-packaging` establishes the complete Eliware
GlusterFS packaging, validation, publication, provenance, and repository-web
baseline. It is designed to produce reproducible public artifacts while
keeping signing credentials, deployment configuration, and private
infrastructure outside the repository.

### Package repositories

- Builds GlusterFS RPMs for the EL10-compatible package repository, including
  the `glusterfs-selinux` package.
- Builds Debian packages independently for Debian 12 Bookworm and Ubuntu
  24.04 Noble; the two distributions have separate package lanes because
  their dependency and repository requirements differ.
- Supports independent stable and rolling channels for each package family:
  - `epel10-stable` and `epel10-rolling` for RPMs.
  - `debian-stable` and `debian-rolling` for Debian packages.
  - `ubuntu-stable` and `ubuntu-rolling` for Ubuntu packages.
- Publishes signed RPM repositories under `/el10/x86_64/` and signed APT
  repositories under distribution-specific Debian and Ubuntu paths.
- Generates repository metadata, checksums, browsable indexes, repository
  configuration, signing-key distribution, and package download URLs.
- Uses date-and-source-commit identifiers for rolling artifacts and stable
  release identifiers for stable artifacts.

### Build and release automation

- Provides the local `gluster-packaging` conductor as the single release
  coordinator.
- Supports explicit `--dry-run` and `--wet-run` modes, with help shown when no
  mode is selected.
- The systemd service performs a dry-run preflight before starting a real run.
- Verifies upstream GlusterFS releases and development commits, supported
  distribution inputs, required external services, local prerequisites, and
  registry/API availability before scheduling work.
- Dispatches six independent CPU-heavy package lanes through GitHub Actions
  and self-hosted ARC runners.
- Uses persistent per-lane workspaces and ccache, with RAM-backed build
  scratch space for faster compilation and cleanup on both success and
  failure.
- Uses bounded retries and backoff for transient network, DNS, TLS, API, and
  rate-limit failures; required inputs that cannot be verified stop the run
  before publication.
- Uses independent package and image checkpoints so successful work is not
  unnecessarily rebuilt on a later run.
- Serializes shared metadata publication and local Docker work with locks to
  prevent concurrent corruption or resource exhaustion.
- Sends Discord notifications for stage progress, checkpoint completion, and
  failure conditions when configured by the operator.
- Supports repository backup and rotation through separate operational release
  tooling without embedding backup destinations or credentials in public
  files; the conductor does not invoke the backup tool.

### Validation gates

- Smoke-1 runs inside each package builder after the candidate packages are
  created.
- Smoke-1 and Smoke-2 validate installation, GlusterFS CLI availability,
  daemon startup, temporary volume creation and mounting, file creation,
  reading, updating, deletion, volume cleanup, and daemon shutdown.
- Smoke-2 runs locally in clean distribution containers and is serialized to
  protect the build host from excessive Docker and memory contention.
- Package candidates are checked for expected files, repository metadata,
  signatures, checksums, and readiness evidence before publication.
- Final runtime images receive a local Smoke-3 test covering package state,
  daemon behavior, volume lifecycle, and file operations.
- Image labels, source commits, base-image digests, package candidates, and
  published image digests are validated before an image is accepted.
- Package and container validation results are retained in release metadata
  and exposed through the public catalog and compatibility matrix.

### Runtime container images

- Builds and publishes minimal GlusterFS runtime images to GHCR for:
  - CentOS Stream 10 / EL10-compatible RPMs.
  - Rocky Linux 10.
  - AlmaLinux 10.
  - Oracle Linux 10.
  - Debian 12 Bookworm.
  - Ubuntu 24.04 Noble.
- Uses the already-published signed package repositories as image inputs.
- Publishes stable tags, rolling date-and-commit tags, convenience aliases,
  and immutable digest references.
- Records image tags, digests, base-image digests, package provenance, and
  container validation in the catalog.
- Keeps the runtime images application-neutral so downstream projects can add
  their own application, configuration, and supervisor layers.

### Metadata, provenance, and release evidence

- Defines versioned metadata contracts tied to the root `package.json`.
- Rejects missing, legacy, unknown, or newer metadata versions instead of
  silently inferring values.
- Provides ordered migration modules for future metadata-shape changes.
- Records source commits, package candidates, validation results, repository
  metadata, signatures, image inputs, image digests, and release manifests.
- Generates signed provenance and release evidence for packages and images.
- Maintains generation records, active-generation state, catalog data,
  repository indexes, checkpoints, validation matrices, and release reports.
- Publishes hashes and public references while excluding credentials, private
  paths, host inventories, volume identifiers, and other deployment details.

### Public repository website

- Provides the public site at
  [glusterfs.eliware.org](https://glusterfs.eliware.org/).
- Includes responsive landing, repository browser, image browser, About,
  Terms, policy, and blog pages.
- Provides RPM/DEB installation wizards with distribution, release,
  architecture, channel, and version selection.
- Provides container pull, Dockerfile, Compose, and Kubernetes examples with
  tag and immutable-digest options.
- Displays current release metadata, validation results, repository files,
  package counts, image records, provenance links, and build dates.
- Serves directory listings with breadcrumbs, sorting, repository metadata,
  local-time display, and human-readable file sizes.
- Provides `/health`, `/ready`, `/healthz`, and `/readyz` endpoints for
  deployment health checks.
- Provides blog listing and article routes, a JSON API, and an RSS feed.
- Reads blog JSON from the shared publication volume at runtime, allowing
  blog posts to be added or updated without rebuilding the HTTP image.
- Bundles and serves the frontend assets through webpack while retaining
  readable source modules and source maps for development.

### Development and quality baseline

- Uses native ECMAScript modules throughout the application and automation
  scripts.
- Includes unit and integration coverage for metadata, validation, package
  lanes, image handling, provenance, conductor behavior, blog documents, and
  repository behavior.
- Includes Puppeteer screenshot checks and Lighthouse checks for the live
  website.
- Provides syntax checks, formatting, linting, dependency auditing, and
  provenance verification commands through `package.json` scripts.
- Documents the pipeline, metadata contracts, blog schema, cluster boundaries,
  backup/log evidence, known future work, and operator automation.

### Release boundaries

This release establishes the initial public contract. It does not promise
backward compatibility with pre-release development artifacts, historical
metadata shapes, temporary build products, or abandoned deployment layouts.
Future metadata changes must use the versioned migration process, and future
release changes should update this document alongside the implementation.
