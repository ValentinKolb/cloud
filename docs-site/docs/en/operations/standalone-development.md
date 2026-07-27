---
title: Standalone development
navTitle: Standalone development
section: Operations
order: 1120
description: Develop an independent application against the published Cloud package.
tags: [development, standalone, npm]
updated: 2026-07-27
---

# Standalone development

A standalone application depends on `@valentinkolb/cloud` from npm.

It owns its repository, version, image, and release cycle. It connects to a
running Cloud deployment at runtime.

## Run the application directly

The development preload configures Solid SSR and watches the application
stylesheet:

```bash
APP_ID=inventory \
APP_DIR=. \
bun run --preload=node_modules/@valentinkolb/cloud/scripts/preload.ts \
src/index.ts
```

`APP_DIR` is the directory containing `src/`.

## Provide the shared platform

A standalone application still needs:

- the gateway;
- Core;
- Postgres;
- Valkey;
- any optional service used by the application.

Core serves the shared global stylesheet, fonts, icon font, and branding
assets. The application serves its own files below `/public/<app-id>/`.

Running the application process alone is not a complete browser environment.

## Use published dependencies only

Import only paths exported by `@valentinkolb/cloud`.

Do not rely on monorepo aliases or import another application package. A
standalone build cannot resolve them.

Keep migrations, settings, routes, and static assets inside the application
repository.

## Verify against the target release

Before release:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
```

Build the same package version used in production. Test registration, login,
one authenticated route, one mutation, and graceful shutdown against the target
Cloud deployment.

See [Build and deploy](/docs/en/operations/build-and-deploy) for the production
bundle.
