# syntax=docker/dockerfile:1

# ---- Build: compile TypeScript and generate the Prisma client ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- Runtime: production deps only, non-root ----
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DATABASE_URL=file:/data/artifact-notifier.db
COPY --from=build --chown=root:root /app/package.json ./
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/prisma ./prisma
COPY --from=build --chown=root:root /app/dist ./dist
# SQLite file lives on a mounted volume, owned by the unprivileged `node` user (uid 1000)
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Apply pending migrations, then start
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
