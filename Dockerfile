FROM node:26-alpine AS base

WORKDIR /target

RUN --mount=type=cache,target=/var/cache/apk \
    apk add --no-cache tini \
    # tini and node binaries
    && mkdir -p ./sbin ./usr/local/bin \
    && cp /sbin/tini ./sbin/ \
    && cp /usr/local/bin/node ./usr/local/bin/ \
    # libc, libgcc and libstdc++ libraries
    && mkdir -p ./lib ./usr/lib \
    && alpineArch="$(apk --print-arch)" \
    && cp -d /lib/ld-musl-$alpineArch.so.* ./lib \
    && cp -d /lib/libc.musl-$alpineArch.so.* ./lib \
    && cp -d /usr/lib/libgcc_s.so.* ./usr/lib \
    && cp -d /usr/lib/libstdc++.so.* ./usr/lib \
    && cp -d /usr/lib/libatomic.so.* ./usr/lib \
    # root ca certificates
    && mkdir -p ./etc/ssl \
    && cp -r /etc/ssl/certs ./etc/ssl \
    # node user
    && echo 'node:x:1000:1000:node,,,:/home/node:/sbin/nologin' > ./etc/passwd \
    && echo 'node:x:1000:node' > ./etc/group \
    && mkdir -p ./home/node ./app \
    && chown 1000:1000 ./home/node ./app

FROM base AS builder

WORKDIR /target/app

COPY --chown=1000:1000 .yarnrc.yml package.json yarn.lock ./
COPY --chown=1000:1000 .yarn ./.yarn

RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    npm install -g corepack && corepack enable \
    && yarn install --immutable

COPY --chown=1000:1000 app.js .
COPY --chown=1000:1000 lib ./lib/

FROM scratch AS runner

COPY --from=builder /target /

ARG PORT=3000

ENV NODE_ENV="production" \
    PORT=${PORT}

WORKDIR /app

USER node

VOLUME ["/home/node"]

EXPOSE ${PORT}

ENTRYPOINT [ "tini", "--"]
CMD ["node", "--require=/app/.pnp.cjs", "--loader=/app/.pnp.loader.mjs", "app.js"]

