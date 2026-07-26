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

Set `CLOUD_DOCS_SITE_URL` to the public origin for production builds so
canonical links, social metadata, `robots.txt`, and the sitemap use absolute
URLs.

```bash
bun run typecheck
bun run build
bun run start
```

Build the deployable container from the repository root:

```bash
docker build -f docs-site/Dockerfile -t cloud-website .
docker run --rm -p 3000:3000 cloud-website
```
