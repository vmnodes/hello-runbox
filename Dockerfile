# Multi-stage. The build stage installs dependencies; the final stage receives
# only the installed app, so neither .git nor the package managers reach what
# runs. Only named files are copied — never `COPY . .` — so nothing else in the
# build context can reach any layer.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
# KNOWN GAP: there is no committed package-lock.json yet, so dependency
# versions float within package.json's ranges (pg ^8.13.0). npm runs only in this
# build stage; the final stage copies the installed node_modules and has npm
# removed. Replace with `npm ci` once a lockfile is committed.
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.js ./

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app

# CVE-2026-14456 (libcrypto3, libssl3) is fixed in Alpine's openssl 3.5.8-r0,
# which no published node:22-alpine image carries yet. The version floor makes
# the build FAIL if the fix is not in the package repository, rather than
# shipping without it. Remove this line once the pinned base image carries
# 3.5.8-r0 or later.
RUN apk add --no-cache 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0'

# Take the package managers out of what runs. They are only needed to install,
# and every CRITICAL and most HIGH findings on this image were in npm's own
# bundled packages, none in the app.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

# Which version of the code is this? The platform passes the full git commit.
# No default: a made-up value would look fine and be wrong forever.
ARG BUILD_COMMIT
RUN case "$BUILD_COMMIT" in \
      "") echo "BUILD_COMMIT is empty: add --build-arg BUILD_COMMIT=\$(git rev-parse HEAD)" >&2; exit 1 ;; \
      *[!0-9a-f]*) echo "BUILD_COMMIT must be a lowercase git commit id, got: $BUILD_COMMIT" >&2; exit 1 ;; \
    esac; \
    if [ "${#BUILD_COMMIT}" != 40 ]; then echo "BUILD_COMMIT must be the full 40 characters, got ${#BUILD_COMMIT}" >&2; exit 1; fi

COPY --from=build /app /app
ENV BUILD_COMMIT=$BUILD_COMMIT \
    PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
