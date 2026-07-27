---
title: Runtime configuration
navTitle: Runtime configuration
section: Operations
order: 1140
description: Configure application containers, platform connections, and environment-specific values.
tags: [configuration, environment, settings]
updated: 2026-07-27
---

# Runtime configuration

Use environment variables for infrastructure. Use Cloud settings for product
configuration.

This keeps container configuration small and lets applications read validated,
encrypted values at runtime.

## Set infrastructure variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection used by Bun SQL |
| `REDIS_URL` | Valkey connection used by Bun Redis |
| `APP_SECRET` | Encrypts settings and credentials |
| `APP_ID` | Selects the application during build or development |
| `PORT` | Service port; defaults to `3000` |
| `NODE_ENV` | Enables production or development behavior |
| `ADMIN_LOGIN_TOKEN` | Local emergency administrator login |

Every application container must use the same `APP_SECRET`.

> Losing or changing `APP_SECRET` makes existing encrypted settings and
> credentials unreadable. Store and rotate it as a deployment secret.

`app.start()` refuses to boot without `APP_SECRET`.

Do not enable `ADMIN_LOGIN_TOKEN` in production.

## Use settings for application values

Declare settings with `defineApp({ settings })`.

The runtime reads them from the shared store, validates them, and decrypts
secrets. A write invalidates the shared cache so other containers see the new
value on their next read.

Use environment fallbacks only for first deployment or infrastructure-managed
values. The setting remains the canonical product configuration.

See [Settings](/docs/en/platform/settings) for declaration and request access.

## Set the public URL

Set `app.url` to the browser-visible origin.

It is used for email links, OAuth redirects, WebAuthn, and other absolute URLs.
Use HTTPS outside localhost.

`APP_URL` can bootstrap this setting.

## Configure optional services

Applications may declare settings for services such as:

- FreeIPA;
- Filegate;
- mail providers;
- OAuth providers;
- AI providers;
- PDF rendering.

Read the page for that service before setting environment fallbacks.

## Validate a deployment

Check configuration in this order:

1. the container received the expected variables;
2. Postgres and Valkey names resolve on the private network;
3. every container shares `APP_SECRET`;
4. `app.url` matches the public origin;
5. required settings validate in the administration UI;
6. the application starts without fallback warnings.

Do not print secrets while diagnosing configuration.
