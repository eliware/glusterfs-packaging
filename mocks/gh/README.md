# Mock GitHub CLI scenarios

Each scenario is an executable replacement for `gh`. They all import the
stateful helper in `common.mjs`, which implements the subset used by the
conductor: workflow dispatch, run discovery, run watching, and artifact
download.

Scenarios:

- `happy.mjs`: every workflow succeeds.
- `rpm-build-failure.mjs`: RPM builders fail.
- `deb-build-failure.mjs`: DEB builders fail.
- `rolling-failure.mjs`: rolling lanes fail while stable lanes succeed.

Smoke-2 now runs locally in Docker, so there are no GitHub mock scenarios for
package smoke workflows. The remaining scenarios cover package-builder
dispatch and checkpoint/resume behavior.

The conductor accepts either long-form or short aliases:

```text
node scripts/conductor.mjs \
  --gh-path "$REPO_ROOT/mocks/gh/scenarios/happy.mjs" \
  --candidate-path /tmp/gluster-candidates \
  --repo-path "$PUBLISH_ROOT" \
  --no-publish
```

The mock state defaults to `/tmp/gluster-packaging-mock-gh`; set
`MOCK_GH_STATE` to isolate or inspect a scenario run. These mocks never call
GitHub and never publish anything themselves.

Use `--no-publish` when exercising the complete conductor state machine with
these mocks. It runs package and image dispatches but skips signing and
publication, so no real repository or signing key is required.
