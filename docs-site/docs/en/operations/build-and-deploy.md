---
title: Build and deploy
navTitle: Build and deploy
section: Operations
order: 1130
description: Build application images and deploy them with the Cloud platform.
tags: [build, docker, deployment]
updated: 2026-07-27
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

Use immutable image tags for production rollouts. Deploy the gateway and Core
alongside compatible application versions.

## Check the rollout

After deployment:

1. confirm that the process stays running;
2. confirm that the application appears in gateway health;
3. inspect skipped or duplicate route warnings;
4. request one route through the gateway;
5. verify migrations and background workers;
6. stop one instance and confirm registry cleanup.

See [Runtime configuration](/docs/en/operations/runtime-configuration) before
setting container values.
