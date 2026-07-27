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

## Use the shared libraries

Do not rebuild functionality already owned by these packages:

| Package | Responsibility |
| --- | --- |
| `@valentinkolb/stdlib` | Results, mutations, dates, browser helpers, encoding, and crypto |
| `@valentinkolb/sync` | Jobs, queues, schedulers, topics, rate limits, and mutexes |
| `@valentinkolb/ssr` | SolidJS islands SSR and navigation |

Import navigation helpers from `@valentinkolb/ssr/nav`. Cloud does not
re-export them.

## Read only what the task needs

| Reference | Use it for |
| --- | --- |
| `architecture.md` | Platform boundary, application definition, lifecycle, routing, and discovery |
| `backend.md` | Hono middleware, HTTP APIs, services, results, SQL, migrations, and state |
| `auth.md` | Authentication, actors, route policies, resource access, API keys, and OAuth |
| `platform.md` | Settings, logging, tracing, audit, search, widgets, PDF, and templates |
| `notifications.md` | Typed notification definitions, delivery, results, and recovery |
| `help.md` | In-product Help collections, routes, rendering, and Markdown |
| `cli.md` | Application CLI modules, flags, input, output, and access commands |
| `workflows.md` | Jobs, queues, schedulers, coordination, and durable workflows |
| `frontend.md` | SSR, shells, islands, clients, URL state, realtime UI, forms, and testing |
| `components.md` | Exact shared component and utility APIs |
| `design.md` | Visual and interaction decisions |
| `ai.md` | AI resources, model policy, chat, tools, files, skills, memory, and background work |
| `ops.md` | Local development, containers, configuration, deployment, scaling, and observability |
| `reference.md` | Supported imports, route conventions, setting kinds, statuses, and migrations |
| `checklist.md` | Final verification before handing off a change |

## Finish the change

Read `checklist.md` before declaring work complete. Run the narrowest relevant
checks first, then the package or repository checks required by the affected
area.
