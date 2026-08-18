FROM quay.io/centos/centos:stream10@sha256:b7f85bb8be4c471bc62842156a51bbf224b15243943733bd54e86ba5fd79b1fc

RUN dnf -y install dnf-plugins-core epel-release \
    && dnf config-manager --set-enabled crb \
    && dnf -y install \
      autoconf automake bash-completion bison cmake curl diffutils file firewalld firewalld-filesystem \
      flex fuse-devel gcc gcc-c++ \
      git glib2-devel libacl-devel libaio-devel libattr-devel libcmocka-devel \
      libcurl-devel libibverbs-devel libtirpc-devel libtool liburing-devel \
      gperftools-devel libuuid-devel libxml2-devel lvm2-devel make ncurses-devel openssl-devel \
      openssl patch pkgconfig pkgconf-pkg-config python3-devel readline-devel rpm-build rpm-sign rpmdevtools \
      rpcgen selinux-policy-devel sqlite-devel systemtap-sdt-devel tar util-linux ccache \
      userspace-rcu-devel xfsprogs zlib-devel createrepo_c \
      buildah podman skopeo jq nodejs \
    && dnf clean all \
    && rm -rf /var/cache/dnf

WORKDIR /work
COPY scripts/ /usr/local/lib/gluster-packaging/scripts/
COPY package.json package-lock.json /usr/local/lib/gluster-packaging/
RUN ln -s /usr/local/lib/gluster-packaging/scripts/build-rpms.mjs /usr/local/bin/build-rpms \
    && ln -s /usr/local/lib/gluster-packaging/scripts/build-workspace.mjs /usr/local/bin/build-workspace
# The builder needs the Gluster client only to mount the persistent workspace.
# This bootstrap dependency comes from the already-published stable repository;
# the RPM compiler and runtime image remain separate.
COPY templates/glusterfs-el10.repo /etc/yum.repos.d/eliware-glusterfs.repo
RUN curl --fail --silent --show-error --location --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 15 --max-time 60 \
      https://glusterfs.eliware.org/keys/RPM-GPG-KEY-ELIWARE-GLUSTER \
      --output /tmp/eliware-gluster-key \
    && rpm --import /tmp/eliware-gluster-key \
    && dnf -y install --setopt=install_weak_deps=False glusterfs-fuse glusterfs-cli \
    && rm -f /tmp/eliware-gluster-key /etc/yum.repos.d/eliware-glusterfs.repo \
    && dnf clean all \
    && rm -rf /var/cache/dnf
RUN chmod 0755 /usr/local/bin/build-rpms
RUN chmod 0755 /usr/local/bin/build-workspace

ENTRYPOINT ["/usr/local/bin/build-rpms"]
