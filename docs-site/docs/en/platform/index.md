---
title: Platform services
navTitle: Overview
section: Platform services
order: 500
description: Choose a shared platform service.
tags: [platform, api, applications]
updated: 2026-07-26
---

# Platform services

Platform services handle features shared by many applications. The application
adds its domain-specific definition. Cloud runs the shared infrastructure.

## Choose a service

| Need | Application contributes | Cloud provides |
| --- | --- | --- |
| Runtime configuration | Typed setting declarations and defaults | Validation, encrypted persistence, caching, and request snapshots |
| Operational events | A source, message, and structured metadata | Console output, redaction, persistence, retention, and operations views |
| One operation across boundaries | Span names, events, and safe attributes | Trace storage, timing, status, and operations views |
| Security evidence | An action, outcome, actor, and target | Durable, sanitized audit storage |
| User communication | Typed payloads and channel-neutral presentation | Preferences, channel routing, durable delivery, retries, and deduplication |
| Global discovery | A permission-aware search provider | Query fan-out and shared search UI |
| Dashboard summaries | Authenticated JSON endpoints | Widget discovery, layout, and rendering |
| Product guidance | Markdown help documents | Search, rendering, and the shared Help surface |
| Documents | HTML or Liquid templates and data | Shared Gotenberg configuration and PDF limits |
| Command-line operations | A typed CLI module | Authentication, profiles, output modes, and dispatch |

Use:

- [Settings](/docs/en/platform/settings) for values an operator may change
  without rebuilding an app.
- [Logging](/docs/en/platform/logging) for diagnostic facts that help operate
  the system.
- [Tracing](/docs/en/platform/tracing) for the lifecycle of one request or
  background operation.
- [Audit events](/docs/en/platform/audit-events) for security and administrative
  evidence.
- [Notifications](/docs/en/platform/notifications) for events a person should
  receive or act on.
- [Universal search](/docs/en/platform/search) to make app resources
  discoverable.
- [Dashboard widgets](/docs/en/platform/dashboard-widgets) for small,
  permission-aware summaries.
- [In-product Help](/docs/en/platform/help) for app-owned user guidance.
- [PDF and templates](/docs/en/platform/pdf-and-templates) for shared document
  rendering.
- [CLI modules](/docs/en/platform/cli-modules) for app commands in `cld`.

These are runtime services, not code generators. They do not copy files into an
application or take ownership of its domain model.

## Import from the correct entry point

```ts
import { defineApp, notification } from "@valentinkolb/cloud";
import { logger, notifications } from "@valentinkolb/cloud/services";
import { type AppContext, middleware } from "@valentinkolb/cloud/server";
```

- The package root contains the application declaration contract and common
  types.
- `/services` contains server-side shared services.
- `/server` contains Hono context types and middleware.
- `/browser`, `/ui`, and `/workflows` are separate boundaries for code that
  runs in those environments.

The complete classification is in [API surface](/docs/en/reference/api-surface).

Server middleware and identity are documented separately:

- [Request middleware](/docs/en/server/middleware)
- [Request identity](/docs/en/identity/authentication)
- [Resource authorization](/docs/en/identity/authorization)
