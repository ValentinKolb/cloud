FROM oven/bun:1.3.14 AS build

WORKDIR /workspace
ARG CLOUD_DOCS_SITE_URL
RUN test -n "$CLOUD_DOCS_SITE_URL" \
  || (echo "CLOUD_DOCS_SITE_URL build argument is required" >&2; exit 1)
ENV CLOUD_DOCS_SITE_URL=$CLOUD_DOCS_SITE_URL

COPY packages/cloud/package.json packages/cloud/package.json
COPY packages/cloud/src packages/cloud/src
COPY packages/ui-lab/package.json packages/ui-lab/package.json
COPY packages/ui-lab/src packages/ui-lab/src
COPY docs-site/package.json docs-site/bun.lock docs-site/
RUN cd docs-site && bun install --frozen-lockfile \
  && ln -s /workspace/docs-site/node_modules /workspace/node_modules

COPY docs-site docs-site
RUN cd docs-site && bun run typecheck && bun run build

FROM oven/bun:1.3.14-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ARG CLOUD_DOCS_SITE_URL
ENV CLOUD_DOCS_SITE_URL=$CLOUD_DOCS_SITE_URL

COPY --from=build /workspace/docs-site/dist/server.js ./server.js
COPY --from=build /workspace/docs-site/dist/server.js.map ./server.js.map
COPY --from=build /workspace/docs-site/dist/_ssr ./_ssr
COPY --from=build /workspace/docs-site/dist/.fibel ./.fibel
COPY --from=build /workspace/docs-site/dist/assets ./assets
COPY --from=build /workspace/docs-site/docs ./docs

EXPOSE 3000
CMD ["bun", "server.js"]
