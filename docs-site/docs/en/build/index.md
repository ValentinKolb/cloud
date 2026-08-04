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

Start with [Platform model](/en/docs/overview) if you need the ownership and
runtime boundary.

## Choose the project shape

Choose the repository from release ownership. The application contract stays
the same.

| Project | Choose it when |
| --- | --- |
| Built-in | Cloud maintainers release the application with the platform |
| Standalone | Another team owns the repository, image, and release |

See [Monorepo development](/en/docs/operations/monorepo-development) or
[Standalone development](/en/docs/operations/standalone-development) for the
different development workflows.

## Build tasks

| Task | Page |
| --- | --- |
| Run a small service locally | [First application](/en/docs/build/getting-started) |
| Look up every `defineApp()` option | [Define an application](/en/docs/build/define-app) |
| Prepare data and manage process work | [Application lifecycle](/en/docs/build/lifecycle) |
| Publish routes through the gateway | [Routes and discovery](/en/docs/build/routing) |
| Add middleware and HTTP APIs | [Server requests](/en/docs/server) |
