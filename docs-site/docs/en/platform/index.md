---
title: Platform APIs
navTitle: Overview
section: Platform APIs
order: 100
description: Choose the Cloud capability that belongs in application code.
tags: [platform, api, applications]
updated: 2026-07-26
---

# Platform APIs

Cloud applications use shared runtime services instead of rebuilding
cross-cutting infrastructure. Each service keeps a narrow boundary: the app
contributes domain-specific definitions and Cloud owns the platform behavior
around them.

## The first three building blocks

| Need | Application contributes | Cloud provides |
| --- | --- | --- |
| Runtime configuration | Typed setting declarations and defaults | Validation, encrypted persistence, caching, and request snapshots |
| Operational events | A source, message, and structured metadata | Console output, redaction, persistence, retention, and operations views |
| User communication | Typed payloads and channel-neutral presentation | Preferences, channel routing, durable delivery, retries, and deduplication |

Use:

- [Settings](/docs/en/platform/settings) for values an operator may change
  without rebuilding an app.
- [Logging](/docs/en/platform/logging) for diagnostic facts that help operate
  the system.
- [Notifications](/docs/en/platform/notifications) for events a person should
  receive or act on.

These are runtime services, not code generators. They do not copy files into an
application or take ownership of its domain model.

## Imports follow the execution boundary

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

The complete classification is in [API surface](/docs/en/platform/api-surface).

## What comes next

Jobs, schedules, queues, and durable workflows form one coherent automation
model. They will be documented together because retry, recovery, leases, and
effects determine how those APIs should be used. A list of isolated function
signatures would hide the important behavior.
