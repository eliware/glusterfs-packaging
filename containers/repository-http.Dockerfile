FROM node:26-bookworm@sha256:0353e48e0e8a993db87b720c242f54b207059d1bcc0106534896e8a11054c837

COPY package.json /opt/gluster-http/package.json
COPY web/ /opt/gluster-http/
COPY site/ /opt/gluster-http/site/
ENV HOST=0.0.0.0 \
    PORT=8080 \
    PUBLIC_DIR=/srv/repository \
    BLOG_DIR=/srv/repository/blogs \
    STATIC_DIR=/opt/gluster-http/site \
    DIRECTORY_TEMPLATE=/opt/gluster-http/site/directory-listing.html \
    CACHE_CONTROL="no-store, no-cache, must-revalidate, max-age=0" \
    SECURITY_HEADERS=true \
    ACCESS_LOG=true \
    DIRECTORY_LISTING=true \
    DIRECTORY_INDEX=true \
    COMPRESSION=true \
    RAM_CACHE=false
WORKDIR /opt/gluster-http
CMD ["node", "src/be/server.mjs"]
