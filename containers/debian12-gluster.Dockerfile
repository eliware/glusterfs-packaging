ARG BASE_IMAGE=debian:12-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
FROM ${BASE_IMAGE}
ARG BASE_IMAGE
ARG DEB_REPO_URL
ARG GLUSTER_VERSION=unknown
ARG DISTRIBUTION=debian
ARG BASE_IMAGE_DIGEST=unknown
ARG PACKAGING_COMMIT=unknown
ARG SOURCE_REF=unknown
ARG SOURCE_COMMIT=unknown
ARG PACKAGE_CANDIDATE=unknown
ARG PACKAGE_PROVENANCE=unknown
ARG APT_GPG_KEY_URL=https://glusterfs.eliware.org/keys/RPM-GPG-KEY-ELIWARE-GLUSTER
LABEL org.opencontainers.image.title="Eliware GlusterFS Debian-family image" \
      org.opencontainers.image.version="${GLUSTER_VERSION}" \
      org.opencontainers.image.revision="${PACKAGING_COMMIT}" \
      org.opencontainers.image.base.name="${DISTRIBUTION}" \
      org.eliware.gluster.base-image.digest="${BASE_IMAGE_DIGEST}" \
      org.eliware.gluster.base-image.reference="${BASE_IMAGE}" \
      org.eliware.gluster.source-ref="${SOURCE_REF}" \
      org.eliware.gluster.source-commit="${SOURCE_COMMIT}" \
      org.eliware.gluster.distribution="${DISTRIBUTION}" \
      org.eliware.gluster.deb-repository="${DEB_REPO_URL}" \
      org.eliware.gluster.package-candidate="${PACKAGE_CANDIDATE}" \
      org.eliware.gluster.package-provenance="${PACKAGE_PROVENANCE}"
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates curl gnupg \
    && rm -rf /var/lib/apt/lists/*
COPY assets/eliware-brand.svg /usr/share/glusterfs/eliware-brand.svg
RUN curl --fail --silent --show-error --location --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 15 --max-time 60 "$APT_GPG_KEY_URL" --output /tmp/eliware-gluster-key \
    && gpg --dearmor --batch --yes --output /usr/share/keyrings/eliware-glusterfs.gpg /tmp/eliware-gluster-key \
    && rm -f /tmp/eliware-gluster-key \
    && printf 'deb [signed-by=/usr/share/keyrings/eliware-glusterfs.gpg] %s stable main\n' "$DEB_REPO_URL" > /etc/apt/sources.list.d/eliware-glusterfs.list \
    && apt-get update \
    && apt-get install --yes --no-install-recommends glusterfs-client glusterfs-server \
    && rm -rf /var/lib/apt/lists/*
