# Build logs and provenance records

This document records the implemented evidence model. The complete release
sequence is defined in [`PIPELINE.md`](PIPELINE.md); this file describes where
evidence is produced, what is signed, and how records are verified.

## Record locations

Package candidates and live builder logs are held in the configured lane
workspace. A builder writes its log beneath the lane's `logs/` directory and
returns a candidate result and validation record.
The conductor uses those files while the lane is active and removes temporary
candidate output and the associated temporary build log after successful
publication. Failed candidates remain available for diagnosis until normal
workspace cleanup or an explicit reset.

Published package provenance is stored beside the package repository's
`provenance.json`. Image provenance is stored under:

```text
metadata/runs/<conductor-run>/<lane>/<distribution>/
  provenance.json
  provenance.json.asc
  checksums.sha256
  assets/
    container-validation.json
    image-build-log (when supplied by the image builder)
```

The public run directory also contains release-report artifacts when they are
generated. Public records contain URLs and hashes, not local filesystem paths
or secret environment data.

## Provenance writers

- `scripts/write-package-provenance.mjs` creates package provenance from the
  package tree, package validation, and package record.
- `scripts/write-provenance.mjs` creates the canonical record, hashes every
  included file, writes `checksums.sha256`, and signs `provenance.json` when
  release signing configuration is available.
- `scripts/verify-provenance.mjs` verifies every recorded file, its size, its
  SHA-256 value, the checksum-manifest digest, and the detached signature.
- `scripts/write-release-manifest.mjs` signs the repository-level manifest,
  which links the catalog and repository index to their hashes and published
  artifacts.

The conductor creates package records before package publication and image
records before image publication. Package records contain the source ref and
commit, packaging commit, workflow run, package version, repository path,
builder validation, and Smoke-2 result. Image records contain the image and
immutable digest, package provenance URL, package repository and metadata
hash, source and packaging commits, base-image digest, and container
validation. This provides a bidirectional package-to-image relationship
through the image's `package_provenance` field.

## Signing and verification

Provenance and release-manifest signing use the configured external release
key. Private keys, passphrases, registry credentials, mount paths, and
environment dumps are never written to records. Unsigned records are allowed
only when the explicit seed/development override is enabled; normal release
publication requires signatures.

Verify a published provenance directory with:

```sh
node scripts/verify-provenance.mjs /path/to/provenance-directory
```

The verifier fails if a recorded file is missing or changed, if a checksum does
not match, or if the detached signature cannot be verified.

## Publication gates and checkpoints

The conductor does not treat a build result as publishable by itself. A lane
must have its package candidate, Smoke-1 result, Smoke-2 result, package
provenance, signatures, repository metadata, and published path verified before
the package checkpoint is reusable. Image completion is tracked separately and
also requires image build output, Smoke-3, immutable-label validation, image
provenance, the GHCR digest, and its package-provenance link.

The conductor updates the catalog, repository index, release manifest, and
checkpoints only through its serialized publication path. A failed lane keeps
its last successful checkpoint and cannot publish an incomplete record. Other
lanes may complete independently.

## Catalog and public links

`metadata/catalog.json` and `metadata/repository-index.json` expose the
published package and image records. The release manifest hashes the catalog
and repository index and enumerates published files. The HTTP application
serves those records through the repository site, including package
provenance, image provenance, validation results, and release reports.

## Retention and reset

Successful published release records are retained with their repository
generation. Rolling package previews are subject to the configured preview
retention policy. Repository snapshots are committed and pushed by the
configured conductor post-run script. Git history provides the recovery
history for the published tree; signing keys, passphrase files, and other
runtime credentials remain outside the repository.

The guarded reset command can restore the publication tree, conductor state,
and lane workspaces to seed state. It preserves lane ccaches unless cache
clearing is explicitly enabled. Reset removes generated packages, metadata,
provenance, candidates, and run history; it does not remove source code or
unrelated container images.

## Evidence limitations

Package builder logs are retained in the workspace for active or failed work,
but successful package cleanup removes the temporary builder log after its
contents have contributed to the candidate result and provenance inputs. Image
build logs are included as provenance assets when the local image builder
returns a log path. If long-term public retention of every successful package
builder log is required, that is a separate enhancement: the conductor would
need to copy the log into the package provenance directory before cleanup and
include it in the signed asset set.
