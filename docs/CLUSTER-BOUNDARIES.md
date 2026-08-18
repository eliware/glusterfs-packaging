# Storage ownership boundaries

The packaging service requires two externally supplied storage locations:

1. a persistent workspace location for build state, logs, and lane caches; and
2. a publication location for repositories, metadata, release records, and web
   content.

Their concrete mount paths, server names, volume identifiers, and credentials
are deployment configuration and must not be committed to this repository.
Configure them through the service environment or an equivalent secret/config
provider.

The packaging service consumes these locations but does not provision or
manage the storage backend. A separate application may use its own storage
cluster; that storage is not a dependency of the packaging conductor, package
builders, or HTTP service.

## Operational rule

Keep build workspaces and published output separate. Keep the packaging storage
backend separate from unrelated application storage. Do not document concrete
hosts, mount paths, volume IDs, or backup endpoints here; operators should
maintain those values in private deployment configuration.
