---
title: Build and deploy
navTitle: Build and deploy
section: Operations
order: 1130
description: Build application images and deploy them with the Cloud platform.
tags: [build, docker, deployment]
updated: 2026-08-01
---

# Build and deploy

The Cloud build creates one self-contained Bun bundle for one application.

It emits the server, Solid island chunks, application CSS, static assets, and
optional application-specific build output.

## Build an application

Inside the monorepo:

```bash
APP_ID=inventory bun run packages/cloud/scripts/build.ts
```

For a standalone application:

```bash
APP_ID=inventory \
APP_DIR=. \
bun run node_modules/@valentinkolb/cloud/scripts/build.ts
```

The output is written to `dist/`:

```text
dist/
├── server.js
├── _ssr/
└── public/
    └── inventory/
        └── app.css
```

Run it with:

```bash
cd dist
bun server.js
```

The bundle does not need `node_modules` at runtime.

## Add build output

Place application assets in `public/`. The build copies them to
`dist/public/<app-id>/`.

Add `scripts/build-extras.ts` only when the application must generate another
artifact. The build sets `WORKSPACE_ROOT` and `DIST_DIR` before importing it.

The build precompresses supported static files with Brotli and gzip.

## Build an image

The root Dockerfile accepts one application ID:

```bash
docker build \
  --build-arg APP_ID=inventory \
  --build-arg CLOUD_RELEASE=sha-0123456789ab \
  -t cloud-app-inventory:local \
  .
```

The final image contains only the bundle and Bun runtime. It listens on port
3000.

A standalone repository can use the same three-stage shape: dependencies,
build, and runtime.

## Deploy the service

Run every application on the private Cloud network.

Give it:

- `DATABASE_URL`;
- `REDIS_URL`;
- the deployment-wide `APP_SECRET`;
- application-specific bootstrap values when needed.

Do not expose the application directly. The gateway discovers its registered
prefixes and proxies public traffic.

Production Compose requires one immutable `CLOUD_IMAGE_TAG` for every runtime
image. Use only a `sha-...` tag whose Docker workflow finished the
`release-set` job; that job proves the complete image set exists.

Render and inspect the deployment before changing containers:

```bash
export CLOUD_IMAGE_TAG=sha-0123456789ab
docker compose -f compose.prod.yml config
bun run prod:preflight
docker compose -f compose.prod.yml pull
```

Pull every image successfully before stopping or recreating services. For the
Sync 5.8 to 5.9 durable namespace boundary, follow `SYNC_5_9_MIGRATION.md` and
stop the complete old runtime before starting the new release set.

## Check the rollout

After deployment:

1. confirm that the process stays running;
2. confirm that the application appears in gateway health;
3. inspect skipped or duplicate route warnings;
4. request one route through the gateway;
5. verify migrations and background workers;
6. confirm every app reports the expected release and Sync version in Admin → Apps;
7. run `bun run prod:preflight` again;
8. stop one instance and confirm registry cleanup.

See [Runtime configuration](/en/docs/operations/runtime-configuration) before
setting container values.
