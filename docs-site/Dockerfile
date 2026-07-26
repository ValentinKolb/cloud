FROM oven/bun:1.3.14 AS build

WORKDIR /workspace
COPY packages/cloud/package.json packages/cloud/package.json
COPY packages/cloud/src packages/cloud/src
COPY docs-site/package.json docs-site/bun.lock docs-site/
RUN cd docs-site && bun install --frozen-lockfile \
  && ln -s /workspace/docs-site/node_modules /workspace/node_modules

COPY docs-site docs-site
RUN cd docs-site && bun run typecheck && NODE_ENV=production bun run build

FROM oven/bun:1.3.14-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /workspace/docs-site/dist ./dist
COPY --from=build /workspace/docs-site/docs ./docs

EXPOSE 3000
CMD ["bun", "dist/server.js"]
