# Metadata migrations

Persistent metadata uses the application version from the root `package.json`
as its `metadata_version`. A release that changes the metadata shape must add
one migration module named `<target-version>-<description>.mjs` here. The module
must export `async function migrate(document)` and return the complete migrated
document without mutating the input.

Metadata readers apply applicable migrations in version order, set the marker
after each successful migration, and atomically write the result back. A
release that changes only application code has no migration module; its readers
advance the marker without changing the document. A document from a newer
package is rejected, and missing or legacy version fields are errors.

Migration modules must preserve unrelated fields, be deterministic, and be
covered by tests for both the source and resulting shapes.
