# Known issues and future-release work

This is the maintained backlog for work that is intentionally deferred from
the current release. It contains engineering improvements, not compatibility
requirements or promises about a specific release date.

## Conductor and domain boundaries

- Define explicit contracts for conductor inputs, lane state, checkpoints,
  validation, publication, status, and release reports.
- Consolidate shared constants for distributions, channels, package formats,
  image targets, and artifact paths.
- Move upstream discovery, immutable base-image resolution, rate-limit policy,
  retry/backoff behavior, and related network handling out of the main
  conductor coordinator.
- Separate conductor-wide locking, run lifecycle, cleanup, and checkpoint
  resume logic from orchestration.
- Separate Smoke-2 and image-lane scheduling, local locks, result merging, and
  failure handling from orchestration.
- Consolidate provenance generation, artifact links, and publication ordering
  behind focused interfaces.
- Split catalog record construction, aggregation, retention, serialization, and
  repository-index updates into clearly owned modules.
- Split `release-report.mjs` so data aggregation, release-card rendering, and
  report publication have separate responsibilities.
- Split `dispatch-workflow.mjs` into API access, status caching, monitoring,
  and artifact retrieval.
- Finish separating candidate publication by package format, generation
  directory, and repository-index responsibilities.
- Replace scattered environment-variable reads with validated configuration
  objects at module boundaries.

## Validation and test coverage

- Expand unit coverage for every extracted pure function.
- Add integration coverage for checkpoint reuse, partial failures,
  publication ordering, interrupted writes, and retry behavior.
- Add failure-injection tests for missing metadata or provenance, invalid image
  digests, corrupt catalogs, and interrupted publication.
- Add committed representative metadata and status snapshots with automated
  comparisons so refactors cannot silently change generated output.
- Keep the four coverage columns—statements, branches, functions, and lines—
  improving across backend, conductor, metadata, publication, and browser
  modules; prioritize modules with the largest uncovered critical paths.
- Complete a clean seeded end-to-end run and validate every package, image,
  provenance record, catalog entry, and repository path as one release.

## Maintenance

- Remove dead helpers, duplicate constants, obsolete paths, and unused scripts
  whenever the remaining boundaries and tests make them safe to delete.
- Keep this file limited to unresolved future work; completed items should be
  removed rather than retained as historical notes.
