# Metadata format policy

All persistent packaging metadata carries a top-level `metadata_version` field.
It identifies the newest schema-changing migration, independently of the
application version in the root `package.json`. This is distinct from the
internal `schema` field: `metadata_version` identifies the metadata contract,
while `schema`
identifies the structure within that contract.

Versioned metadata includes:

- `metadata/catalog.json` and package/image metadata;
- generation records and `active-generation.json`;
- conductor state;
- repository indexes and release manifests; and
- signed provenance records.

Readers reject unknown, missing, legacy, or newer metadata versions. When a
metadata shape changes, add an ordered migration module under `migrations/`
named for the target package version. Readers apply each applicable migration,
advance `metadata_version` after it succeeds, and atomically persist the
result. Releases without a metadata shape change do not need a migration; they
leave the marker unchanged. Normal builds and publications
must never silently transform metadata without a versioned migration.

Writers and readers also reject the legacy `meta_version` name. Required fields
are validated as required fields; a missing, empty, or null required value is a
metadata error rather than a condition for a fallback or inferred value.

## Metadata module ownership

- `metadata-version.mjs` defines the current metadata contract version.
- `metadata-io.mjs` performs version-aware metadata reads and atomic writes.
- `serialization.mjs` owns canonical timestamps and JSON serialization.
- `validation-schema.mjs` validates required metadata shapes.
- `image-checkpoint.mjs` validates reusable image checkpoints.
- `write-provenance.mjs`, `write-package-provenance.mjs`, and
  `write-release-manifest.mjs` create signed release evidence.
- `catalog-repositories.mjs` builds distribution-aware repository links;
  `write-catalog.mjs` and `rebuild-catalog.mjs` write and aggregate catalog
  records.
- `generate-repository-index.mjs` writes browsable repository indexes.
- `conductor-final-validation.mjs` performs the final cross-artifact checks
  before a run is complete.

The conductor coordinates these writers and validators. No HTTP handler or
individual build lane may update shared release metadata directly.

## Canonical image checkpoints

Each `checkpoint.images[distribution]` entry describes exactly one published
image and must use the image's own immutable inputs. The canonical shape is:

```json
{
  "status": "published",
  "source_commit": "<GlusterFS commit>",
  "package_candidate": "<package candidate id>",
  "base_image": "<image reference>@sha256:<base digest>",
  "distribution": "<distribution id>",
  "provenance": "/metadata/runs/<run>/<lane>/<distribution>/provenance.json",
  "result": {
    "image": "ghcr.io/eliware/<repository>:<tag>",
    "digest": "sha256:<published digest>",
    "base_image": "<same immutable image reference>",
    "base_image_digest": "sha256:<same base digest>"
  }
}
```

The checkpoint-level `base_image` is the resolved immutable base image for that
specific distribution; it must never contain the package lane's base image.
Checkpoint validation compares these per-image inputs, the package candidate,
source commit, published digest, and provenance document before reusing an
image.
