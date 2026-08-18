ARG BASE_IMAGE=quay.io/centos/centos:stream10@sha256:b7f85bb8be4c471bc62842156a51bbf224b15243943733bd54e86ba5fd79b1fc
FROM ghcr.io/actions/actions-runner:latest AS github-runner
FROM ${BASE_IMAGE}

ARG GLUSTER_VERSION=unknown
ARG CENTOS_BASE_DIGEST=unknown

LABEL org.opencontainers.image.title="Eliware GlusterFS CentOS 10 builder" \
      org.opencontainers.image.description="Public GlusterFS RPM build toolchain" \
      org.opencontainers.image.version="${GLUSTER_VERSION}" \
      org.opencontainers.image.base.name="CentOS Stream 10" \
      org.opencontainers.image.base.digest="${CENTOS_BASE_DIGEST}"

# This is a compiler/runner base image only. Gluster packages are deliberately
# absent; package publication and repository access are separate workflow steps.
RUN dnf -y install dnf-plugins-core epel-release \
    && dnf config-manager --set-enabled crb \
    && dnf -y install \
      autoconf automake bash-completion bison cmake curl diffutils file firewalld firewalld-filesystem \
      flex fuse3 fuse-devel gcc gcc-c++ \
      git glib2-devel libacl-devel libaio-devel libattr-devel libcmocka-devel \
      libcurl-devel libibverbs-devel libtirpc-devel libtool liburing-devel \
      gperftools-devel libicu libuuid-devel libxml2-devel lvm2-devel make ncurses-devel openssl-devel \
      openssl patch pkgconfig pkgconf-pkg-config python3-devel readline-devel rpm-build rpm-sign rpmdevtools \
      rpcgen selinux-policy-devel sqlite-devel systemtap-sdt-devel tar util-linux ccache \
      userspace-rcu-devel xfsprogs zlib-devel createrepo_c which \
      buildah podman skopeo jq nodejs \
    && dnf clean all \
    && rm -rf /var/cache/dnf

# Keep the image self-contained when it is used directly as an ARC runner.
COPY --from=github-runner /home/runner/ /home/runner/
RUN chmod 0755 /home/runner/run.sh /home/runner/bin/Runner.Listener \
    && printf '%s\n' '1' > /home/runner/.eliware-runner-runtime

WORKDIR /work
