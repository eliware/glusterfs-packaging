#!/usr/bin/env bash
set -euo pipefail

cd /opt/gluster-packaging

command -v node >/dev/null
command -v npm >/dev/null

npm ci --ignore-scripts
npm test
npm run lint

echo "secondary CI passed"
