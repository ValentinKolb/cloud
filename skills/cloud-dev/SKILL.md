---
name: cloud-dev
description: >
  Build and maintain applications on Cloud, the open-source Bun, Hono, and
  SolidJS application platform that runs on your infrastructure. Use this
  skill for application declarations, server routes, services, data, identity
  and access, platform services, automation, frontend work, AI, operations, or
  deployment. It applies to built-in monorepo applications and standalone
  applications that use @valentinkolb/cloud. Use cloud-cli instead when the
  task is to operate an existing Cloud installation from the terminal.
---

# Build on Cloud

Cloud gives independently deployed applications a shared platform for
identity, permissions, data, UI, settings, notifications, automation, and
operations.

The developer documentation is the canonical source for the contracts in this
skill. The files in `references/` are generated from that documentation unless
their header says otherwise.

## Establish the contract

Use sources in this order:

1. public package exports and types;
2. implementation and tests of the public contract;
3. shared primitive documentation;
4. generated references in this skill;
5. existing applications as examples.

An existing application is not authoritative when it conflicts with a public
contract or shared primitive.

Cloud applications can live in `packages/<id>/` in this monorepo or in a
standalone repository. Both use `defineApp()`, the same server and frontend
APIs, and the same runtime model. Deployment setup is the main difference.

## Keep these boundaries

1. Resolve request identity through `actor` and `accessSubject`. Do not
   authorize from `c.get("user")` or `User.memberofGroupIds`.
2. Protect routes with route policy middleware. Check resource access again in
   the service or query that reads or changes the resource.
3. Repeat permission checks in SSR pages because they call services directly.
4. Keep filtering, sorting, pagination, and aggregation on the server. Put
   shareable user intent in the URL.
5. Use the typed Hono client for application JSON APIs.
6. Wrap user-initiated frontend writes in `mutation.create()`.
7. Keep migrations idempotent. Do not add and then drop a column.
8. Keep authentication, sessions, roles, principals, and credentials in the
   platform.
9. Keep workflow runs, leases, retry, recovery, and the effect journal in the
   workflow kernel.
10. Treat logs as operational evidence, not as a durable business record.
11. Re-check current resource access immediately before a durable,
    permission-sensitive external effect.
12. Commit a domain change before sending its notification. Derive recipients
    from trusted server state and retry with the same domain-event key.
13. If a frontend claims no-JavaScript writes, include the validated server
    POST handler that makes the form action real.

## Use the shared libraries

Do not rebuild functionality already owned by these packages:

| Package | Responsibility |
| --- | --- |
| `@k2b/stdlib` | Results, mutations, dates, browser helpers, encoding, and crypto |
| `@k2b/sync` | Jobs, queues, schedulers, topics, rate limits, and mutexes |
| `@k2b/ssr` | SolidJS islands SSR and navigation |

Import navigation helpers from `@k2b/ssr/nav`. Cloud does not
re-export them.

## Read only what the task needs

| Task | References |
| --- | --- |
| Understand or create an application | `architecture.md`, `getting-started.md`, `application.md` |
| Build server routes and services | `middleware.md`, `http.md`, `services.md` |
| Store and migrate application data | `data.md`, `migrations.md` |
| Resolve identity and protect access | `auth.md`, `route-access.md`, `authorization.md`, `credentials.md` |
| Use platform services | `platform.md`, `settings.md`, `observability.md` |
| Send notifications or add product help and CLI commands | `notifications.md`, `help.md`, `cli.md` |
| Publish agent-friendly Types, Queries, and Actions | `capabilities.md` |
| Run background work | `automation.md`, `schedules.md` |
| Build durable workflows | `workflows.md`, `workflow-runtime.md` |
| Build server-rendered interfaces | `frontend.md`, `browser.md`, `frontend-ui.md` |
| Choose shared components and interaction patterns | `components.md`, `design.md` |
| Build AI features | `ai.md`, `ai-runtime.md` |
| Develop, deploy, and operate Cloud | `development.md`, `deployment.md`, `ops.md` |
| Check public APIs and conventions | `reference.md`, `conventions.md` |
| Verify a finished change | `checklist.md` |

## Finish the change

Read `checklist.md` before declaring work complete. Run the narrowest relevant
checks first, then the package or repository checks required by the affected
area.

Representative code must be coherent with current public types. Include every
required import and configuration field, identify app-owned placeholders, and
do not use casts or ellipses to conceal missing contracts. For workflow
authoring, retain a reproducible compile-and-bind check.
