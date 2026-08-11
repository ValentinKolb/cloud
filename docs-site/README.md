# Cloud website

One Bun service exposes the complete public website:

- `/en` — marketing homepage
- `/en/docs` — Fibel developer documentation
- `/en/ui` — live examples imported from the Cloud UI source
- `/health` — container health endpoint

From the repository root, start the same Linux container on macOS or Linux:

```bash
bun run dev:fibel
```

Development defaults to [http://localhost:4187/en](http://localhost:4187/en).
The command returns after `/health` is ready. The container rebuilds the local
Cloud UI stylesheet when it starts, and Bun reloads it when mounted TypeScript
or component source changes. Run `bun run dev:fibel` again to re-index Markdown;
the cached image is reused and the command waits for the replacement container.

```bash
bun run dev:fibel:logs
bun run dev:fibel:down
```

Set `FIBEL_PORT=4199` on the start command when port `4187` is occupied.

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
