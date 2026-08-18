ARG BASE_IMAGE=ubuntu:24.04
FROM ghcr.io/actions/actions-runner:latest AS github-runner
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      build-essential ca-certificates ccache curl debhelper devscripts \
      dh-exec dh-python dpkg-dev equivs fakeroot git nodejs npm apt-utils \
      libicu-dev pkg-config python3 xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Keep the image self-contained when it is used directly as an ARC runner.
COPY --from=github-runner /home/runner/ /home/runner/
RUN chmod 0755 /home/runner/run.sh /home/runner/bin/Runner.Listener \
    && printf '%s\n' '1' > /home/runner/.eliware-runner-runtime

WORKDIR /work/packaging
ENTRYPOINT ["node", "/work/packaging/scripts/build-debs.mjs"]
