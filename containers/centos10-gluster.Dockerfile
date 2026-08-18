ARG BASE_IMAGE=quay.io/centos/centos:stream10@sha256:b7f85bb8be4c471bc62842156a51bbf224b15243943733bd54e86ba5fd79b1fc
FROM ${BASE_IMAGE}

ARG BASE_IMAGE
ARG RELEASE_VERSION=stable
ARG DISTRIBUTION=centos-stream
ARG PACKAGING_COMMIT=unknown
ARG BASE_IMAGE_DIGEST=unknown
ARG SOURCE_REF=unknown
ARG SOURCE_COMMIT=unknown
ARG RPM_REPO_URL
ARG RPM_METADATA_SHA256
ARG PACKAGE_CANDIDATE=unknown
ARG PACKAGE_PROVENANCE=unknown
ARG RPM_GPG_KEY_URL=https://glusterfs.eliware.org/keys/RPM-GPG-KEY-ELIWARE-GLUSTER

LABEL org.opencontainers.image.title="Eliware ${DISTRIBUTION} GlusterFS"
LABEL org.opencontainers.image.description="Minimal GlusterFS runtime and bootstrap base image"
LABEL org.opencontainers.image.source="https://github.com/eliware/glusterfs-packaging"
LABEL org.opencontainers.image.version="${RELEASE_VERSION}"
LABEL org.opencontainers.image.revision="${PACKAGING_COMMIT}"
LABEL org.eliware.gluster.base-image.digest="${BASE_IMAGE_DIGEST}"
LABEL org.eliware.gluster.base-image.reference="${BASE_IMAGE}"
LABEL org.eliware.gluster.source-ref="${SOURCE_REF}"
LABEL org.eliware.gluster.source-commit="${SOURCE_COMMIT}"
LABEL org.eliware.gluster.distribution="${DISTRIBUTION}"
LABEL org.eliware.gluster.rpm-repository="${RPM_REPO_URL}"
LABEL org.eliware.gluster.rpm-metadata-sha256="${RPM_METADATA_SHA256}"
LABEL org.eliware.gluster.package-candidate="${PACKAGE_CANDIDATE}"
LABEL org.eliware.gluster.package-provenance="${PACKAGE_PROVENANCE}"

RUN test -n "${RPM_REPO_URL}" \
    && test -n "${RPM_METADATA_SHA256}" \
    && dnf -y install dnf-plugins-core \
    && dnf -y install epel-release \
    && dnf config-manager --set-enabled crb \
    && curl --fail --silent --show-error --location --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 15 --max-time 60 "${RPM_GPG_KEY_URL}" --output /tmp/eliware-gluster-key \
    && rpm --import /tmp/eliware-gluster-key \
    && printf '[eliware-glusterfs]\nname=Eliware GlusterFS\nbaseurl=%s\nenabled=1\ngpgcheck=1\nrepo_gpgcheck=1\ngpgkey=%s\n' "${RPM_REPO_URL}" "${RPM_GPG_KEY_URL}" > /etc/yum.repos.d/eliware-glusterfs.repo \
    && curl --fail --silent --show-error --location --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 15 --max-time 60 "${RPM_REPO_URL}repodata/repomd.xml" --output /tmp/repomd.xml \
    && printf '%s  /tmp/repomd.xml\n' "${RPM_METADATA_SHA256}" | sha256sum --check --status \
    && dnf -y --enablerepo=eliware-glusterfs install \
         glusterfs glusterfs-server glusterfs-selinux glusterfs-cli \
         glusterfs-client-xlators glusterfs-fuse glusterfs-gnfs \
         libgfapi0 libgfchangelog0 libgfrpc0 libgfxdr0 libglusterfs0 \
         python3-gluster nodejs \
    && dnf clean all \
    && rm -f /tmp/eliware-gluster-key /tmp/repomd.xml \
    && rm -rf /var/cache/dnf

COPY containers/gluster-bootstrap.mjs /usr/local/bin/gluster-bootstrap.mjs
RUN chmod 0755 /usr/local/bin/gluster-bootstrap.mjs

WORKDIR /app

# The operator supplies the bootstrap environment; application images may
# override this entrypoint when they need a different process supervisor.
ENTRYPOINT ["/usr/local/bin/gluster-bootstrap.mjs"]
CMD []
