---
title: Build an application
navTitle: Overview
section: Build an app
order: 100
description: Choose a built-in or standalone application.
tags: [applications, architecture, deployment]
updated: 2026-07-27
---

# Build an application

A Cloud application is an independently deployed HTTP service.

It declares itself with `defineApp()`, owns a Hono router, and passes its
`fetch` handler to `app.start()`.

Read [Platform model](/docs/en/overview) for the platform and application
ownership boundary.

## Repository and release ownership

The runtime contract is the same for built-in and standalone applications.
Choose the repository from release ownership.

| Project | Use it when | Development dependency |
| --- | --- | --- |
| Built-in | Cloud maintainers release the application with the platform | `@valentinkolb/cloud: "workspace:*"` |
| Standalone | Another team owns the application release | A published `@valentinkolb/cloud` version |

A built-in application lives under `packages/` and joins the repository's
Compose stack. A standalone application owns its repository, image, and
deployment pipeline.

Do not branch domain code on the project type. Both forms use `defineApp()`,
Hono, and `app.start()`.

See [Monorepo development](/docs/en/operations/monorepo-development) or
[Standalone development](/docs/en/operations/standalone-development) for the
deployment-specific steps.

## Build tasks

| Task | Page |
| --- | --- |
| Run a small service locally | [First application](/docs/en/build/getting-started) |
| Look up every `defineApp()` option | [Define an application](/docs/en/build/define-app) |
| Prepare data and manage process work | [Application lifecycle](/docs/en/build/lifecycle) |
| Publish routes through the gateway | [Routes and discovery](/docs/en/build/routing) |
| Add middleware and HTTP APIs | [Server requests](/docs/en/server) |
