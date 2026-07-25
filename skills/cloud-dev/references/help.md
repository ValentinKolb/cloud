# App Help

End-user Help is app-owned Markdown rendered by the shared reader. The Markdown is the canonical source — for the in-product reader, the full-page view, copy-as-Markdown, CLI and agent consumers, and review. Never maintain a parallel JSX corpus or an app-local Help renderer.

This page covers the **mechanics**: registration, routes, and the exact Markdown the renderer supports. For *how to write* the prose itself — structure, voice, what belongs in an article — use the `docs-writer` skill:

```bash
bunx skills add valentinkolb/skills
```

## Collection and registration

```ts
// src/help/index.ts
import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/start.help.md" with { type: "text" };
import work from "./documents/work.help.md" with { type: "text" };

export const appHelp = defineHelpCollection({
  basePath: "/api/example/help",
  sources: [start, work],
});
```

Documents live at `src/help/documents/*.help.md`. There is **no filesystem scanning** — order and ownership stay in code. A duplicate `id` throws at module load. Entries sort by `order`, then by title.

The collection exposes `manifest`, `router`, and `getMarkdown(id)`.

Mount the router behind the app's own authentication, **before** the general API route:

```ts
const helpRoutes = new Hono<AuthContext>().use(auth.requireRole("user")).route("/", appHelp.router);

const router = new Hono<AuthContext>()
  .route("/api/example/help", helpRoutes)
  .route("/api/example", apiRoutes);
```

> `defineApp` has no `help` field. Wiring is these two manual steps: mount the router, and render the island below.

## The island bridge

```tsx
// frontend/_components/help/AppLayoutHelp.island.tsx
import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

const HELP_PAGE_BASE = "/app/example/help";

export default function AppLayoutHelp(props: {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
  mode?: "register" | "page";
}) {
  return props.mode === "page" ? (
    <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase={HELP_PAGE_BASE} />
  ) : (
    <Layout.HelpDocuments documents={props.documents} pageBase={HELP_PAGE_BASE} />
  );
}
```

> The `Layout` here is **not** the page shell. The page shell is `Layout` from `@valentinkolb/cloud/ssr`; this is a separate namespace object from `@valentinkolb/cloud/ssr/islands` that carries the Help members. They share a name and nothing else.

| Member | Role |
|---|---|
| `Layout.HelpDocuments` | **Registrar.** Renders `null`; registers the manifest so the global Help modal can open the app's topics. `pageBase` is required |
| `Layout.HelpPage` | **Reader.** Renders the full Help surface for the app's own `/help` route |
| `Layout.Help` | **Legacy** JSX-tab registrar. Zero app call sites. Do not use it in new code |

`HelpDocuments` registers into a browser-side registry, so it **must** run inside a `.island.tsx`. A plain SSR wrapper renders nothing and registers nothing. Pass the server-created manifest in; never import the collection into the client bundle.

Register the bridge on **every** user-facing route where the shell can open Help — including the overview or list page, before any entity is selected. Help that only appears after selecting an entity is incomplete.

## SSR routes

Every Help-enabled app owns a hub and an article route under its normal mount:

```ts
export default new Hono<AuthContext>()
  .get("/help",        auth.requireRole("user", auth.redirectToLogin), ...helpPage)
  .get("/help/:topic", auth.requireRole("user", auth.redirectToLogin), ...helpPage)
  // …dynamic routes after these
```

Both routes use the same page, which validates the requested topic against the manifest:

```tsx
export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = appHelp.manifest.some((d) => d.id === requested) ? requested : undefined;
  c.get("page").title = "Example help";
  return () => <AppLayoutHelp documents={appHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
```

Register these **before** dynamic or catch-all routes. Full-page Help must render only the shared Help surface — never the app workspace behind it — and must not use a `?help=` query overlay.

## Document contract

```md
---
id: getting-started
title: Getting started
icon: ti ti-rocket
description: Learn the app's core workflow.
order: 10
---

Article content starts here.
```

| Key | Required | Rule |
|---|---|---|
| `id` | yes | lowercase kebab-case: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` |
| `title` | yes | non-empty |
| `icon` | no | **full** Tabler class including the prefix — `ti ti-mail-plus` |
| `description` | no | non-empty; shown in the Help hub |
| `order` | no | integer, default `100`. Use a 10-spaced scale so you can insert later |

Missing frontmatter or an empty body throws at load.

> **Hard line breaks render as `<br>`.** The renderer sets `breaks: true`, so a hard-wrapped paragraph shows ragged line breaks in the reader. Write **one line per paragraph** and let it wrap.

## Markdown

Write normal Markdown first. Reach for the Help-only affordances below only when they make an existing structure easier to scan — the source must stay readable to a plain Markdown reader that ignores them.

### Section headings

Level-two headings define the article sections and the table of contents. **Every H2 must carry an icon** — this is enforced by a test, and the ToC reads it.

```md
## Connect your first mailbox {icon="square-plus"}
```

The marker is trailing-only, lowercase letters/digits/dashes, and the Tabler name **without** the `ti ti-` prefix — the opposite of the frontmatter `icon`. It applies at H2 only; on any other level it is not processed. Heading ids are slugified and de-duplicated per document, so a repeated title becomes `…-2`. Use H3 inside a section; never skip a level to get a size.

### Guided blocks

Three, and only three. The directive name comes immediately after `:::` with no space and no title, content starts on the next line, and the closing `:::` is on its own line.

`:::steps` — a real ordered workflow where sequence matters. **Requires a top-level ordered list.**

```md
:::steps
1. **Choose a source:** Select the account that owns the data.
2. **Review the preview:** Confirm the records and permissions.
3. **Save:** Create the import and wait for completion.
:::
```

`:::reference` — labelled concepts, fields, or rules whose order does not matter. **Requires a top-level bullet list**, and the styling keys off a bold term at the start of each item.

```md
:::reference
- **Owner:** The account responsible for the item.
- **Status:** The current workflow state.
:::
```

`:::compare` — two or three alternatives answering the same decision. **Requires a top-level bullet list.**

```md
:::compare
- **Markdown:** Rich formatting with a generated HTML alternative.
- **Plain text:** A text-only message without preview.
:::
```

The block only adds a wrapper; the required list inside is what the styling actually targets. Get the list type wrong and the block renders unstyled.

> An unrecognised directive — `:::timeline` — degrades to ordinary prose **silently**. No warning, no error, and the text survives. Do not invent new markers; they will simply not work.

Guided syntax inside a fenced code block is inert, as expected.

### Eyebrows

A paragraph consisting of **exactly one bold run** and nothing else becomes a styled eyebrow label:

```md
**Find exact records**
```

`A **base** contains tables.` is untouched. This only styles as a direct child of the article body — a lone-bold paragraph nested inside a `:::` block or a list item gets no styling.

### Callouts

Five types: `note`, `info`, `success`, `warning`, `danger`. An optional argument after the name overrides the label.

```md
:::warning Before deleting
Deletion cannot be undone after the retention period.
:::
```

Two constraints that are easy to violate:

- **No space after the colons.** `::: note` does not work; only `:::note` does.
- **Callout bodies are not full Markdown.** Only `**bold**`, `*italic*`, `` `code` ``, and line breaks are processed. **Links, lists, and nested blocks do not work inside a callout.** Put anything structural outside it.

### Code

The highlighter recognises exactly these fence languages:

| Highlighting | Accepted names |
|---|---|
| Shell | `bash`, `sh`, `shell`, `zsh` |
| JS/TS | `javascript`, `js`, `jsx`, `ts`, `tsx`, `typescript`, `script` |
| GraphQL / GQL | `gql`, `graphql` |
| YAML | `yaml`, `yml` |

Anything else — including `json`, `html`, and `text` — is **not** an error: it renders as clean escaped monospace with the language badge, just without colouring. `text` is the conventional way to ask for a deliberately unhighlighted block.

Help code is always inert; a ` ```script ` fence is displayed as source and never becomes executable. Never hand-write highlighting HTML.

> **Never use a ` ```mermaid ` fence in a Help document.** The Help reader does not run the client-side diagram enhancer, so it renders a permanent "Loading diagram…" box.

## Selection rules

- Prefer prose, headings, lists, tables, code, and callouts before reaching for a marker.
- One visual form per meaning throughout an article.
- Do not box every list. Containers communicate grouping, not decoration.
- Never write `.help-*` classes or raw HTML in app documentation.
- Never hardcode an app colour — Help uses the current app theme tokens.
- Open an article with orienting prose before the first H2; do not start directly on a heading.
- Keep dynamic, resource-specific inspectors in app UI. Help is for stable concepts.
- Titles are task-first; descriptions short enough to scan in the hub.
- When migrating an existing corpus, keep every established fact and edge case.

## Verification

Several rules are enforced by tests, not convention. A change that breaks one fails `typecheck`:

- Every app that calls `defineApp` must own at least one `*.help.md`.
- Every document needs at least one H2, and **every H2 outside fenced code needs `{icon="…"}`**.
- No duplicate rendered H2 ids within a document.
- Rendered HTML must not leak raw `:::steps` / `:::compare` / `:::reference` or `{icon="`.
- Adding a Help-enabled app means adding it to the route test's app table, which asserts both `/help` and `/help/:topic` exist.
- A hydration test asserts the Help members are reached from exactly one island and never nested inside another.

Beyond the tests, check manually: every manifest document returns 200 with non-empty Markdown; the modal and the full-page view both work; and long content, narrow viewports, keyboard focus, light mode, and dark mode all hold up.
