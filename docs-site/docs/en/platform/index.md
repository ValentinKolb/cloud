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

These are runtime services, not code generators. They do not copy files into an
application or take ownership of its domain model.

Open the page for the service you need from the navigation. Use
[Building blocks](/docs/en/building-blocks) when you know the task but not the
service, or [API surface](/docs/en/reference/api-surface) to look up an import.

Request middleware and identity are separate application boundaries:
[Request middleware](/docs/en/server/middleware) loads request context, while
[Identity and access](/docs/en/identity) explains caller and resource checks.
