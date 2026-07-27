---
title: Operations
navTitle: Overview
section: Operations
order: 1100
description: Run Cloud applications from local development through production.
tags: [operations, deployment, runtime]
updated: 2026-07-27
---

# Operations

Cloud runs each application as an independent Bun service.

The gateway is the only public entry point. Applications, Postgres, Valkey, and
supporting services share a private network.

## Choose the development shape

| Shape | Use it when |
| --- | --- |
| [Monorepo development](/docs/en/operations/monorepo-development) | You change Cloud itself or a built-in application |
| [Standalone development](/docs/en/operations/standalone-development) | Your application consumes the published package |

Both shapes use the same application contract. They differ in dependency and
container ownership.

## Deployment workflow

1. [Build the application](/docs/en/operations/build-and-deploy).
2. [Set infrastructure configuration](/docs/en/operations/runtime-configuration).
3. Configure application values through [Settings](/docs/en/platform/settings).
4. [Scale and stop services safely](/docs/en/operations/scaling-and-shutdown).
5. Use [Observability](/docs/en/operations/observability) for health and failure.
6. Use [Troubleshooting](/docs/en/operations/troubleshooting) when the registry,
   gateway, or dependencies disagree.

FreeIPA is optional. See [FreeIPA](/docs/en/operations/freeipa) only when
the deployment uses it.
