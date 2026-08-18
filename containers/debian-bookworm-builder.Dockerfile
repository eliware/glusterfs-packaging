ARG BASE_IMAGE=debian:12-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
FROM ghcr.io/actions/actions-runner:latest AS github-runner
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive

# This is a compiler/runner base image only. Gluster packages are deliberately
# absent; package publication and repository access are separate workflow steps.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      build-essential ca-certificates ccache curl debhelper devscripts \
      dh-exec dh-python dpkg-dev equivs fakeroot git nodejs npm apt-utils \
      libicu72 pkg-config python3 xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Keep the image self-contained when it is used directly as an ARC runner.
COPY --from=github-runner /home/runner/ /home/runner/
RUN chmod 0755 /home/runner/run.sh /home/runner/bin/Runner.Listener \
    && printf '%s\n' '1' > /home/runner/.eliware-runner-runtime

WORKDIR /work/packaging
ENTRYPOINT ["node", "/work/packaging/scripts/build-debs.mjs"]
