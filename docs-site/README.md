# Cloud website

One Bun service exposes the complete public website:

- `/en` — marketing homepage
- `/docs/en` — Fibel developer documentation
- `/ui` — live examples imported from the Cloud UI source
- `/health` — container health endpoint

```bash
bun install
bun run dev
```

Development defaults to [http://localhost:4187/en](http://localhost:4187/en).
The server rebuilds the local Cloud UI stylesheet when it starts, and Bun
restarts it when imported TypeScript or component source changes.

Production builds require `CLOUD_DOCS_SITE_URL`. Set it to the public origin,
without a trailing path, so canonical links, social metadata, `robots.txt`, and
the sitemap use absolute URLs.

```bash
bun run typecheck
CLOUD_DOCS_SITE_URL=https://cloud.example bun run build
CLOUD_DOCS_SITE_URL=https://cloud.example bun run start
```

Build the deployable container from the repository root:

```bash
docker build \
  --build-arg CLOUD_DOCS_SITE_URL=https://cloud.example \
  -f docs-site/Dockerfile \
  -t cloud-website .
docker run --rm \
  -e CLOUD_DOCS_SITE_URL=https://cloud.example \
  -p 3000:3000 \
  cloud-website
```
