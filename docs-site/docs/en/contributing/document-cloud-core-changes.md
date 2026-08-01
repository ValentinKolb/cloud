---
title: Document Cloud core changes
navTitle: Document core changes
section: Contributing
order: 1300
description: Keep developer docs, UI examples, and the Fibel-backed Cloud skill aligned with core changes.
tags: [contributing, documentation, maintenance]
updated: 2026-07-28
---

# Document Cloud core changes

Documentation is part of the public contract. A core change is complete when
every affected developer-facing source describes the same behavior as the code.

## Decide what the change affects

| Change | Required documentation |
| --- | --- |
| Public API, behavior, default, error, or permission rule | Update the capability guide and its example. |
| New package export or subpath | Add it to [API surface](/en/docs/reference/api-surface) and link a guide that explains when to use it. |
| Renamed, deprecated, or removed contract | Add the supported replacement and migration to [Deprecations](/en/docs/reference/deprecations-and-migrations). |
| Shared UI component or interaction contract | Update the UI catalog context and live example. |
| Runtime configuration, deployment, or operational behavior | Update the matching [Operations](/en/docs/operations) page. |
| Internal refactor with no observable contract change | No public documentation change is required. Keep non-obvious invariants in tests or code comments. |

Do not document an export only because it exists. Application-facing APIs need
a supported use case. Platform-owned helpers stay outside application guides
unless a maintainer workflow requires them.

## Update the canonical source

Developer documentation lives in `docs-site/docs/en/`. Update the page that
owns the changed capability instead of repeating the rule on several pages.
Use cross-links when another page owns a prerequisite or adjacent workflow.

Shared component documentation lives in `docs-site/src/ui/context/`. Most pages
follow the `<section>/<page>.md` layout. The matching demo is registered through
`docs-site/src/ui/catalog.ts` and `docs-site/src/ui/demo-sections/`.

The Markdown context is the source for people, search, the AI assistant, MCP,
raw Markdown routes, and `llms.txt`. Do not recover documentation from rendered
component HTML.

Fibel publishes one self-contained `cloud-dev` skill from
`docs-site/agent-skills/cloud-dev/SKILL.md`. The skill contains the stable work
process and platform invariants. Detailed contracts stay in the canonical
documentation and are read through MCP.

## Use the local documentation MCP

Agents working in this repository should read the current working tree through
the local Fibel server.

Check whether the default endpoint exposes the current route shape:

```bash
curl --fail --silent http://localhost:4187/health | rg '"/en/docs"'
```

If it does not, start the documentation site from the current checkout:

```bash
bun run dev:fibel
```

It listens on port `4187` by default. If that port belongs to an older local
instance, choose a free port and use the same port in `CLOUD_DOCS_SITE_URL`:

```bash
PORT=4199 CLOUD_DOCS_SITE_URL=http://localhost:4199 bun run dev:fibel
```

Add the active MCP endpoint with the stable local name `cloud-dev-mcp`.

For Codex:

```bash
codex mcp get cloud-dev-mcp
codex mcp remove cloud-dev-mcp # only when an existing URL is stale
codex mcp add cloud-dev-mcp --url http://localhost:4187/_fibel/mcp
```

For Claude Code:

```bash
claude mcp get cloud-dev-mcp
claude mcp remove cloud-dev-mcp # only when an existing URL is stale
claude mcp add --transport http cloud-dev-mcp http://localhost:4187/_fibel/mcp
```

For another code agent, configure a streamable HTTP MCP server named
`cloud-dev-mcp` with the same endpoint. The **Agents** dialog in the Fibel
footer provides additional client-specific setup.

Replace `4187` when the current server uses another port.

Refresh the agent session after adding the connection. The agent should confirm
that `cloud-dev-mcp` is available by calling `list_collections`, then use
`search_docs` and `read_doc` for current documentation.

Repository-wide agent instructions live in `AGENTS.md`. Claude Code imports
the same file through `CLAUDE.md`; do not maintain a second set of rules there.

Running the website and configuring MCP are separate steps. A healthy website
does not make its tools visible to an agent that has not connected the
endpoint.

If the MCP connection is unavailable or still targets an older local instance,
the agent should say so instead of silently relying on stale knowledge.
When the connection cannot be added, read `docs-site/docs/en` directly and
state that the task is using that reduced documentation mode.

## Keep the contract complete

A capability guide should answer one question at a time:

1. what the capability does;
2. when an application should use it;
3. which import and configuration start the supported path;
4. which options, defaults, errors, and permission boundaries affect behavior;
5. how success is verified;
6. which related guide owns the next decision.

Examples must compile against current public types. Include required imports and
configuration. Do not use casts or omitted fields to conceal an incomplete
contract.

UI context should also state:

- when to use and avoid the component;
- who owns its state;
- its important properties and callbacks;
- relevant accessibility, SSR, and hydration behavior;
- the exact TSX rendered by the live example.

## Update agent knowledge

Do not copy API details from a changed guide into the published skill. Fibel
search, MCP, raw Markdown, and `llms.txt` expose the canonical page directly.
Change the skill only when the stable Cloud work process or a cross-cutting
invariant changes. Add or update its cases in
`docs-site/evals/cloud-dev/evals.json` when that workflow changes.

## Run the relevant checks

```bash
bun run --cwd docs-site check:docs
bun run --cwd docs-site check:api-surface
bun run --cwd docs-site check:example-coverage
bun run --cwd docs-site check:ui-catalog
bun run --cwd docs-site check:harness
bun run --cwd docs-site typecheck
```

Run the checks affected by the change while editing. Run the complete set
before handing off a change that alters a public contract.

## Review the finished change

- Public behavior and documentation use the same names.
- One page owns each rule; other pages link to it.
- New APIs include a supported task and a checked example.
- Breaking or deprecated behavior includes a migration.
- UI pages include explicit Markdown context and a representative live state.
- Documentation links, raw Markdown, search, MCP, and `llms.txt` expose the page.
- The published skill contains workflow and invariants, not duplicated API docs.
- The local MCP returns the current Docs and UI collections.
- Code, tests, documentation, and agent knowledge ship together.
