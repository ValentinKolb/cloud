---
name: cloud-dev
description: >
  Build and maintain applications on Cloud, the open-source Bun, Hono, and
  SolidJS application platform that runs on your infrastructure. Use this
  skill whenever work touches Cloud application declarations, routes,
  middleware, services, data, identity and access, settings, notifications,
  jobs, workflows, shared UI, AI, observability, development, or deployment.
  It applies to built-in applications in the Cloud monorepo and standalone
  applications using @valentinkolb/cloud. Use cloud-cli instead when the task
  only operates an existing Cloud installation.
---

# Build on Cloud

Cloud applications are independently deployed HTTP services. Each application
owns its domain, routes, durable data, image, and release cycle. Cloud supplies
shared identity, access, UI, data foundations, automation, observability,
discovery, and operations.

Use the following gates for every change. They keep implementation decisions
grounded in the current platform contract without copying that contract into
this skill.

## 1. Read the live contract

Inside the Cloud repository, prefer the current checkout's local Fibel MCP so
uncommitted documentation is visible. Look for `cloud-dev-mcp`, call
`list_collections`, then search with `search_docs` and read the smallest
relevant pages with `read_doc`.

If the connection is missing, check or start the current site:

```bash
bun run dev:fibel
codex mcp add cloud-dev-mcp --url http://localhost:4187/_fibel/mcp
```

Use the active port when `4187` is unavailable. Ask the human to add or refresh
the MCP connection when the tools are not visible in the current agent session.
Do not change their Codex configuration without permission.

If MCP cannot be enabled, state that the task is using reduced documentation
mode and read `docs-site/docs/en`, public exports, types, and focused tests
directly. Outside the monorepo, use the configured Cloud documentation MCP when
available.

**Gate:** current documentation was read through MCP, or reduced mode is
explicit.

## 2. Choose the owner

Name one owner before choosing a file or abstraction:

- the platform library owns shared application contracts and mechanisms;
- Core owns global Cloud product surfaces;
- the gateway owns registry-driven request routing;
- an application owns its domain behavior and data;
- shared UI owns portable interaction contracts;
- documentation owns developer knowledge;
- deployment owns placement, networking, and infrastructure.

Put a contract in the lowest shared layer that truly owns it. A built-in
application is useful evidence, but it is not the authority for a public
platform contract.

**Gate:** one layer and one observable behavior are named.

## 3. Define the contract

State the user-visible or caller-visible outcome, public interface, permission
boundary, durable owner, and failure behavior. Search the Docs collection for
runtime and platform rules. Search the UI collection before choosing or adding
a shared component. For UI work, always read the `Styling and accessibility`
page before changing a screen or shared primitive.

Use sources in this order for exact behavior:

1. public exports and types;
2. implementation and focused tests of that public contract;
3. current Fibel documentation;
4. real applications as examples.

Resolve disagreement instead of preserving two versions of the contract.

**Gate:** callers can be described without implementation details.

## 4. Build one vertical slice

Implement the smallest complete path through the affected boundaries. Keep
transport conversion in Hono handlers, domain rules in the application, and
shared mechanisms in the platform package that owns them. Reuse public Cloud
and K2B entry points.

In the Cloud monorepo, inspect `git status` before editing. Preserve unrelated
and parallel work. Change only owned files, avoid broad rewrites, and never
stage or discard another agent's changes.

Do not add speculative hooks, aliases, compatibility paths, casts,
placeholders, or unrelated cleanup.

**Gate:** one end-to-end behavior works through its public seam.

## 5. Verify the behavior

Start with the fastest check that can disprove the change. For a bug, reproduce
the reported symptom first. Verify the highest public seam that exposes the
behavior, then widen checks only when the changed boundary requires it.

Review the owned diff and run `git diff --check`. Report checks that could not
run and any remaining uncertainty.

**Gate:** focused verification passes at the affected seam.

## 6. Keep knowledge current

Update the canonical Fibel page, example, or UI context when observable
behavior changes: public exports, options, defaults, errors, permissions,
lifecycle, routes, configuration, deployment rules, or shared component
contracts. Link to the page that owns an adjacent rule instead of repeating it.

Internal refactors with unchanged behavior need no public prose. Keep
non-obvious internal invariants in focused tests or code comments.

For shared UI, update the Markdown context and a representative live state.
Markdown is the source for people, search, the assistant, MCP, raw Markdown,
and `llms.txt`; never reconstruct knowledge from rendered HTML.

**Gate:** code, tests, current documentation, and agent knowledge agree.

## Stable UI invariants

- Use shared primitives and semantic styling. Fix a shared primitive at its
  owner instead of compensating in one app with copied markup or local CSS.
- Do not use `<hr>`, `divide-y`, full-width `border-t` or `border-b`,
  pseudo-element rules, or inset-shadow hairlines to group ordinary content.
- Functional boundaries are owned by shared tables, compound controls, and
  interactive layout separators. App code does not invent exceptions.
- Build hierarchy with spacing, alignment, typography, and shared surfaces.
  Do not replace a removed separator with a box or hover fill around every row.
- Keep app identity, actions, status, selection, and data color roles
  independent.
- Treat responsive, dark, hover, focus, active, selected, disabled, loading,
  empty, and error states as part of the same UI contract.

## Stable Cloud invariants

- Gateway prefixes select an application; the application's Hono router owns
  the request.
- Declared prefixes, mounted routes, and gateway registration must agree. A
  running process alone does not prove route readiness.
- Cloud authenticates actors and resolves access subjects. Applications choose
  and enforce permissions for concrete resources.
- Route policy controls entry. Services and queries repeat resource
  authorization, including direct SSR calls.
- Use `actor` and `accessSubject` for request identity. Do not authorize from
  `c.get("user")`, navigation visibility, or display-only group metadata.
- Applications own durable domain data. Postgres persists it; Valkey
  coordinates bounded runtime work.
- Commit domain state before retryable notifications or external effects. Use
  stable event or effect keys.
- SSR owns initial data and permissions. Solid islands own the smallest browser
  interaction region.
