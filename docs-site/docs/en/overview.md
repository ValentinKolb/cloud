---
title: Platform model
navTitle: Platform model
section: Start
order: 20
description: Understand why Cloud applications are independent services and where the platform boundary ends.
tags: [architecture, apps, runtime]
updated: 2026-08-12
---

# Platform model

A Cloud application is an independently deployed HTTP service. This boundary
lets an application own its domain, data, version, image, and release cycle
without becoming part of the Cloud platform process.

It declares its public route prefixes and one stable service address. The
gateway forwards matching requests to that address. The orchestrator
distributes requests across replicas.

These developer docs assume the application lives in its own repository and
uses published packages. Built-in applications follow the same runtime
contract, but their source layout is maintainer guidance rather than the model
for a third-party app.

## Keep platform and domain ownership separate

| Cloud owns | An app owns |
| --- | --- |
| Accounts, sessions, credentials, roles, and groups | Domain resources and business rules |
| Principal and permission semantics | The permission required for each domain operation |
| Gateway, registry, and shared runtime services | HTTP routes and middleware |
| Shared UI and administration surfaces | Application pages and interactions |
| Platform schemas | An optional application-owned Postgres schema |
| Settings, notifications, logging, and other shared services | Application-specific definitions and domain events |

Cloud standardizes the parts that must agree across applications. The
application keeps the rules that give its resources meaning. Moving domain
behavior into platform services would couple unrelated release cycles; copying
identity or permission models into an app would create incompatible security
boundaries.

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

## Use three public seams

An application connects to Cloud through three APIs:

| API | Responsibility |
| --- | --- |
| `defineApp()` | Declare identity, routes, navigation, and platform definitions |
| Hono router | Handle requests and compose middleware |
| `app.start()` | Register the service and run its lifecycle |

These APIs connect a service to Cloud without loading application code into the
gateway. The gateway learns a live route table from registration; it does not
import, build, or release the application.

## Run application instances

Several instances of one application can run at the same time. Store durable
state in Postgres or another explicit store. Do not store it in process memory
or container files.

Third-party and built-in applications use the same public runtime contract.
The difference is who owns the repository and release, not how requests,
identity, data, or registration work.

Continue with [Build an application](/en/docs/build). Use
[Building blocks](/en/docs/building-blocks) to find a platform API.
