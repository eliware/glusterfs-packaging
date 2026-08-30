#!/usr/bin/env bash
set -euo pipefail

publication_root="/mnt/pvc/gluster-repository-http"
packaging_root="/opt/gluster-packaging"

cd "$packaging_root"
command -v node >/dev/null
command -v git >/dev/null
command -v gpg >/dev/null
command -v jq >/dev/null

test -d "$publication_root/.git"
test -z "$(git -C "$publication_root" status --porcelain)"
git -C "$publication_root" fetch --no-tags origin main
test "$(git -C "$publication_root" rev-parse HEAD)" = "$(git -C "$publication_root" rev-parse origin/main)"

test -s "$publication_root/metadata/active-generation.json"
test -s "$publication_root/metadata/catalog.json"
jq -e '.generation and .run_id' "$publication_root/metadata/active-generation.json" >/dev/null
jq -e '.schema and .stable and .preview and (.packages | type == "array") and (.images | type == "array")' \
  "$publication_root/metadata/catalog.json" >/dev/null

# Reuse the conductor's complete read-only checkpoint, provenance, and
# publication consistency checks. --no-rebuild prevents any package build.
node scripts/conductor.mjs --dry-run --no-rebuild --no-publish

echo "publication validation passed"
