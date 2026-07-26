# Cloud website

The Cloud marketing homepage and developer documentation are served by Fibel.

```bash
bun install
bun run dev
```

Set `CLOUD_DOCS_SITE_URL` to the public origin for production builds so
canonical links, social metadata, `robots.txt`, and the sitemap use absolute
URLs.

```bash
bun run typecheck
bun run build
```
