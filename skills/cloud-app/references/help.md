# App Help

Cloud Help is app-owned Markdown rendered by the shared `Layout.Help` reader.
The Markdown is the canonical source for the in-product reader, full-page Help,
copy-as-Markdown, CLI consumers, agents, and reviews. Do not maintain a parallel
JSX corpus or app-specific Help renderer.

## Collection and registration

Define an explicit server-owned collection:

```ts
import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/start.help.md" with { type: "text" };

export const appHelp = defineHelpCollection({
  basePath: "/api/example/help",
  sources: [start],
});
```

Mount the collection router behind the app's normal authentication. Pass only
the manifest into a hydrated `.island.tsx` bridge:

```tsx
import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr/islands";

export default function AppLayoutHelp(props: {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
  mode?: "register" | "page";
}) {
  return props.mode === "page" ? (
    <Layout.HelpPage documents={props.documents} initialTopic={props.initialTopic} pageBase="/app/example/help" />
  ) : (
    <Layout.HelpDocuments documents={props.documents} pageBase="/app/example/help" />
  );
}
```

Register that bridge on every user-facing route where the shell can open Help,
including overview and list routes before a notebook, base, space, account, or
other entity is selected. A plain SSR wrapper does not register documents.

Add app-owned SSR routes for both the Help hub and an article, for example
`/app/example/help` and `/app/example/help/:topic`. The handlers render only
the shared Help page island with the same manifest and select `initialTopic`
from the route parameter. Put these routes before dynamic or catch-all routes.
Full-page Help must not load the normal app workspace in the background and
must not use query-parameter overlays or a parallel renderer.

The shared reader owns the modal, search, navigation, responsive article table
of contents, copy-as-Markdown, keyboard and focus behavior, safe Markdown
rendering, and the reload-safe full-page view. Apps own only content, explicit
article order, authentication, and factual accuracy.

## Document contract

Every document uses strict frontmatter and normal Markdown:

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

Write normal Markdown first. Use the Help-only annotations below only when they
make an existing structure easier to scan. The source must remain understandable
when a plain Markdown reader ignores those annotations.

### Section headings

Level-two headings define the main article sections and the responsive table of
contents. Add an optional Tabler icon name without the `ti ti-` prefix:

```md
## Create the first item {icon="square-plus"}
```

The renderer removes the metadata, creates a stable heading id, and applies the
app theme color through shared CSS variables. Use H3 headings inside a section.
Do not skip heading levels to obtain a visual size.

### Guided steps

Use `:::steps` only for a real ordered workflow where sequence matters:

```md
:::steps
1. **Choose a source:** Select the account that owns the data.
2. **Review the preview:** Confirm the records and permissions.
3. **Save:** Create the import and wait for completion.
:::
```

Do not turn an ordinary numbered reference list into steps merely for styling.

### Scannable reference

Use `:::reference` for a compact set of labeled concepts, paths, fields, or
rules whose order does not matter:

```md
:::reference
- **Owner:** The account responsible for the item.
- **Status:** The current workflow state.
- **Updated:** The last successful change.
:::
```

Use a Markdown table instead when readers need to compare several repeated
fields across many entries. Keep inline code in table cells as normal backtick
code; the shared renderer owns its appearance.

### Side-by-side comparison

Use `:::compare` only when two or three alternatives answer the same decision:

```md
:::compare
- **Markdown:** Rich formatting with a generated HTML alternative.
- **Plain text:** A text-only message without preview.
:::
```

Do not place unrelated notes beside one another simply to fill a row.

### Callouts and code

Existing semantic callouts remain normal Markdown directives:

```md
:::warning Before deleting
Deletion cannot be undone after the retention period.
:::
```

Use fenced code with an accurate language such as `ts`, `js`, `gql`, `yaml`,
`json`, `bash`, or `text`. Help code is always inert. Syntax highlighting and
safe rendering are shared behavior; never add handwritten highlighting HTML.

## Selection rules

- Prefer prose, headings, lists, tables, code, and callouts before a special
  marker.
- Use one visual form for one meaning throughout an article.
- Do not box every list. Containers communicate grouping, not decoration.
- Do not write `.help-*` classes or raw HTML in app documentation.
- Do not hardcode an app color. Shared Help uses the current app theme tokens.
- Keep all established facts and edge cases when migrating an existing corpus.
- Keep dynamic resource inspectors in app UI; stable concepts belong in Help.
- Keep article titles task-first and descriptions short enough to scan in the
  Help hub.

## Verification

Every Help collection should verify:

1. Manifest ids and order are explicit.
2. Every manifest document has non-empty Markdown and returns HTTP 200.
3. Rendered HTML contains stable H2 ids where the article has H2 sections.
4. Raw `:::steps`, `:::compare`, `:::reference`, and `{icon="..."}` syntax does
   not leak into rendered HTML.
5. Script examples remain inert and supported languages highlight correctly.
6. Overview and detail routes register the same manifest unless access rules
   intentionally require separate collections.
7. The shared modal and full-page mode both work; no app-local Help dialog,
   window, or renderer remains.

Run the collection tests, shared Markdown and Layout Help tests,
`git diff --check`, and a focused browser pass for long content, narrow
viewports, keyboard focus, light mode, and dark mode.
