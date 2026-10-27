# syntax=docker/dockerfile:1.7
# Build reproduzível: versão do Node fixada, lockfile congelado, pnpm fixado via corepack.
ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Dependências completas (inclui ferramentas de build). O postinstall roda `prisma generate`.
FROM base AS deps
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# Somente dependências de produção (prisma CLI incluído para `migrate deploy`).
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prod && rm -rf src/generated

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
# Usuário sem privilégios (uid 1000 da imagem oficial).
USER node
EXPOSE 9464
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||9464)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Sinais e processos-zumbi: use `init: true` no Compose (tini embutido do Docker).
CMD ["node", "dist/src/index.js"]
