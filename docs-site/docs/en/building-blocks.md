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
| Declare and register an application | `defineApp()` and `app.start()` | `@valentinkolb/cloud` | [Build an application](/en/docs/build) |
| Handle a request | Middleware and response helpers | `@valentinkolb/cloud/server` | [Server requests](/en/docs/server) |
| Check identity and access | Actor, access subject, roles, and permissions | `@valentinkolb/cloud/server` | [Identity and access](/en/docs/identity) |
| Store domain records | Bun SQL and Postgres helpers | `bun`, `@valentinkolb/cloud/services` | [Data ownership](/en/docs/data) |
| Read runtime configuration | Settings declarations and snapshots | package root, `/server`, `/services` | [Settings](/en/docs/platform/settings) |
| Write operational logs | Structured logger | `@valentinkolb/cloud/services` | [Logging](/en/docs/platform/logging) |
| Trace one operation | Spans and trace events | `@valentinkolb/cloud/services` | [Tracing](/en/docs/platform/tracing) |
| Record security evidence | Audit events | `@valentinkolb/cloud/services` | [Audit events](/en/docs/platform/audit-events) |
| Send notifications | Typed definitions and delivery | package root, `/services` | [Notifications](/en/docs/platform/notifications) |
| Publish agent-friendly reads and mutations | Types, Queries, and Actions | `@valentinkolb/cloud`, `/contracts` | [App capabilities](/en/docs/platform/capabilities) |
| Add resources to global search | Universal Search Query | `@valentinkolb/cloud/contracts` | [Universal search](/en/docs/platform/search) |
| Add a dashboard summary | Widget declaration and response contract | package root, `/contracts` | [Dashboard widgets](/en/docs/platform/dashboard-widgets) |
| Add product guidance | Help collection | `@valentinkolb/cloud/server` | [In-product Help](/en/docs/platform/help) |
| Render documents | Template and PDF services | `@valentinkolb/cloud/services` | [PDF and templates](/en/docs/platform/pdf-and-templates) |
| Add CLI commands | CLI module builders | `@valentinkolb/cloud/cli` | [CLI modules](/en/docs/platform/cli-modules) |
| Run jobs or coordinate instances | Jobs, queues, schedulers, topics, and mutexes | `@k2b/sync` | [Automation](/en/docs/automation) |
| Add durable workflows | Workflow definitions and runtime adapters | `@valentinkolb/cloud/workflows` | [Workflow overview](/en/docs/automation/workflow-overview) |
| Render application pages | SSR shells, islands, and navigation | `@valentinkolb/cloud/ssr`, `@k2b/ssr` | [Frontend](/en/docs/frontend) |
| Use shared components | Portable UI package | `@k2b/ui` | [UI catalog](/ui) |
| Add AI features | AI resources, models, tools, and streaming | `@valentinkolb/cloud/ai` | [AI](/en/docs/ai) |

The [API surface](/en/docs/reference/api-surface) lists every supported import.

Domain-specific behavior stays in the application.
