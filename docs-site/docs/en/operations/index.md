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
| [Monorepo development](/en/docs/operations/monorepo-development) | You change Cloud itself or a built-in application |
| [Standalone development](/en/docs/operations/standalone-development) | Your application consumes the published package |

Both shapes use the same application contract. They differ in dependency and
container ownership.

## Deployment workflow

1. [Build the application](/en/docs/operations/build-and-deploy).
2. [Set infrastructure configuration](/en/docs/operations/runtime-configuration).
3. Configure application values through [Settings](/en/docs/platform/settings).
4. [Scale and stop services safely](/en/docs/operations/scaling-and-shutdown).
5. Use [Observability](/en/docs/operations/observability) for health and failure.
6. Use [Troubleshooting](/en/docs/operations/troubleshooting) when the registry,
   gateway, or dependencies disagree.

FreeIPA is optional. See [FreeIPA](/en/docs/operations/freeipa) only when
the deployment uses it.
