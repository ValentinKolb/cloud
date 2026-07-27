---
title: Find a platform API
navTitle: Building blocks
section: Start
order: 30
description: Match an application task to the Cloud API that supports it.
tags: [platform, api, services]
updated: 2026-07-27
---

# Find a platform API

Find the task in the table. Use the listed import and reference.

| Task | API | Import | Reference |
| --- | --- | --- | --- |
| Declare and register an application | `defineApp()` and `app.start()` | `@valentinkolb/cloud` | [Build an application](/docs/en/build) |
| Handle a request | Middleware and response helpers | `@valentinkolb/cloud/server` | [Server requests](/docs/en/server) |
| Check identity and access | Actor, access subject, roles, and permissions | `@valentinkolb/cloud/server` | [Identity and access](/docs/en/identity) |
| Store domain records | Bun SQL and Postgres helpers | `bun`, `@valentinkolb/cloud/services` | [Data ownership](/docs/en/data) |
| Read runtime configuration | Settings declarations and snapshots | package root, `/server`, `/services` | [Settings](/docs/en/platform/settings) |
| Write operational logs | Structured logger | `@valentinkolb/cloud/services` | [Logging](/docs/en/platform/logging) |
| Trace one operation | Spans and trace events | `@valentinkolb/cloud/services` | [Tracing](/docs/en/platform/tracing) |
| Record security evidence | Audit events | `@valentinkolb/cloud/services` | [Audit events](/docs/en/platform/audit-events) |
| Send notifications | Typed definitions and delivery | package root, `/services` | [Notifications](/docs/en/platform/notifications) |
| Add resources to global search | Search capability | `@valentinkolb/cloud/contracts` | [Universal search](/docs/en/platform/search) |
| Add a dashboard summary | Widget declaration and response contract | package root, `/contracts` | [Dashboard widgets](/docs/en/platform/dashboard-widgets) |
| Add product guidance | Help collection | `@valentinkolb/cloud/server` | [In-product Help](/docs/en/platform/help) |
| Render documents | Template and PDF services | `@valentinkolb/cloud/services` | [PDF and templates](/docs/en/platform/pdf-and-templates) |
| Add CLI commands | CLI module builders | `@valentinkolb/cloud/cli` | [CLI modules](/docs/en/platform/cli-modules) |
| Run jobs or coordinate instances | Jobs, queues, schedulers, topics, and mutexes | `@valentinkolb/sync` | [Automation](/docs/en/automation) |
| Add durable workflows | Workflow definitions and runtime adapters | `@valentinkolb/cloud/workflows` | [Workflow overview](/docs/en/automation/workflow-overview) |
| Render application pages | SSR shells, islands, and navigation | `@valentinkolb/cloud/ssr`, `@valentinkolb/ssr` | [Frontend](/docs/en/frontend) |
| Use shared components | Cloud UI package | `@valentinkolb/cloud/ui` | [UI catalog](/ui) |
| Add AI features | AI resources, models, tools, and streaming | `@valentinkolb/cloud/ai` | [AI](/docs/en/ai) |

The [API surface](/docs/en/reference/api-surface) lists every supported import.

Domain-specific behavior stays in the application.
