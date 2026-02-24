FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS install
# Workspace manifests for deterministic install
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/package.json
COPY packages/lib/package.json packages/lib/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/apps/package.json packages/apps/package.json
COPY packages/standalone/package.json packages/standalone/package.json
RUN bun install --frozen-lockfile

FROM base AS prerelease
COPY --from=install /usr/src/app/node_modules ./node_modules
COPY --from=install /usr/src/app/packages ./packages
COPY . .
WORKDIR /usr/src/app/packages/standalone

ENV NODE_ENV=production
RUN bun run build

FROM base AS release
ENV BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS=1

# Install fontconfig + JetBrains Mono for avatar fallback rendering
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig && rm -rf /var/lib/apt/lists/*
COPY --from=install /usr/src/app/node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2 /usr/share/fonts/truetype/jetbrains-mono.woff2
RUN fc-cache -f

# Runtime files
COPY --from=install /usr/src/app/node_modules ./node_modules
COPY --from=prerelease /usr/src/app/packages/standalone/dist ./dist
COPY --from=prerelease /usr/src/app/packages/standalone/public ./dist/public
COPY --from=prerelease /usr/src/app/packages/standalone/package.json ./package.json
COPY --from=prerelease /usr/src/app/packages/standalone/scripts/entrypoint.sh ./entrypoint.sh
RUN ln -s ./dist/public ./public && chmod +x ./entrypoint.sh

USER bun
EXPOSE 3000/tcp
ENTRYPOINT ["./entrypoint.sh"]
