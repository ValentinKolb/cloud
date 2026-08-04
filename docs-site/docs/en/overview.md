---
title: Platform model
navTitle: Platform model
section: Start
order: 20
description: See what Cloud owns and what each application owns.
tags: [architecture, apps, runtime]
updated: 2026-07-27
---

# Platform model

A Cloud application is an independently deployed HTTP service.

It declares its public route prefixes and one stable service address. The
gateway forwards matching requests to that address. The orchestrator
distributes requests across replicas.

## Separate platform and application code

| Cloud owns | An app owns |
| --- | --- |
| Accounts, sessions, credentials, roles, and groups | Domain resources and business rules |
| Principal and permission semantics | The permission required for each domain operation |
| Gateway, registry, and shared runtime services | HTTP routes and middleware |
| Shared UI and administration surfaces | Application pages and interactions |
| Platform schemas | An optional application-owned Postgres schema |
| Settings, notifications, logging, and other shared services | Application-specific definitions and domain events |

An application uses Cloud's identity model and shared services. Its domain
behavior stays in the application.

## Handle a request

```text
client
  → gateway
  → application router
  → domain service
  → application data or platform service
```

The gateway chooses the application by URL prefix. The application chooses its
middleware, validates input, checks resource access, and runs the domain
operation.

## Connect an application

An application connects to Cloud through three APIs:

| API | Responsibility |
| --- | --- |
| `defineApp()` | Declare identity, routes, navigation, and platform definitions |
| Hono router | Handle requests and compose middleware |
| `app.start()` | Register the service and run its lifecycle |

These APIs do not generate or load application code into the gateway.

## Run application instances

Several instances of one application can run at the same time. Store durable
state in Postgres or another explicit store. Do not store it in process memory
or container files.

Built-in and standalone applications use the same contract. Their repository
and release ownership differ; their runtime model does not.

Continue with [Build an application](/en/docs/build). Use
[Building blocks](/en/docs/building-blocks) to find a platform API.
