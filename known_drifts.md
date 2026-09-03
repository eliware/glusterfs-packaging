# Known convention drifts

| Area | Status | Reason / owner | Verification |
|---|---|---|---|
| `@eliware/test` | drift | This operational Node.js application currently uses Jest and Oxlint directly; migrate when the shared test package supports the required coverage and subprocess-test behavior. Owner: packaging. | Revisit with the next test-tooling release. |
| 100×4 coverage | drift | The existing suite does not yet cover the conductor’s external orchestration paths. Owner: packaging. | `npm test` reports current coverage. |
| `@eliware/common` / `@eliware/ssh-client` | exempt | This repository uses Node’s process APIs and argument arrays for local/remote build orchestration; migrating the operational scripts requires an API review and would be a larger change than convention-only alignment. Owner: packaging. | Review before extracting reusable application services. |
| Knit target | exempt | `.knit/deploy.yaml` intentionally targets `dev`, the currently configured secondary-CI host; `dev0` deployment remains an operational migration step. Owner: packaging/operations. | Verify when the host migration is complete. |
