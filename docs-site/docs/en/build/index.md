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

Start with [Platform model](/docs/en/overview) if you need the ownership and
runtime boundary.

## Choose the project shape

Choose the repository from release ownership. The application contract stays
the same.

| Project | Choose it when |
| --- | --- |
| Built-in | Cloud maintainers release the application with the platform |
| Standalone | Another team owns the repository, image, and release |

See [Monorepo development](/docs/en/operations/monorepo-development) or
[Standalone development](/docs/en/operations/standalone-development) for the
different development workflows.

## Build tasks

| Task | Page |
| --- | --- |
| Run a small service locally | [First application](/docs/en/build/getting-started) |
| Look up every `defineApp()` option | [Define an application](/docs/en/build/define-app) |
| Prepare data and manage process work | [Application lifecycle](/docs/en/build/lifecycle) |
| Publish routes through the gateway | [Routes and discovery](/docs/en/build/routing) |
| Add middleware and HTTP APIs | [Server requests](/docs/en/server) |
