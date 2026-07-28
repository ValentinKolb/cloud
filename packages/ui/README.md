# @k2b/ui

Opinionated SolidJS components for `@k2b/ssr` applications. The package uses
semantic CSS variables, Tabler icon class names, and precompiled component
styles without a global reset.

```ts
import "@k2b/ui/styles.css";
import { Button, DatePicker, StatusBadge, prompts } from "@k2b/ui";
```

Wrap the rendered application in the UI scope:

```tsx
<main class="k2b-ui">
  <Placeholder title="Nothing here yet" />
</main>
```

Fonts and theme stacks are CSS variables and can be replaced without
JavaScript:

```css
.k2b-ui {
  --k2b-font-sans: Inter, sans-serif;
  --k2b-accent-50: #f5f3ff;
  --k2b-accent-100: #ede9fe;
  --k2b-accent-300: #c4b5fd;
  --k2b-accent-400: #a78bfa;
  --k2b-accent-500: #8b5cf6;
  --k2b-accent-600: #7c3aed;
  --k2b-accent-700: #6d28d9;
  --k2b-accent-950: #2e1065;
}
```

IBM Plex is an optional preset:

```ts
import "@k2b/ui/fonts/plex.css";
```

Tabler's webfont is the supported icon preset:

```ts
import "@k2b/ui/icons/tabler.css";
```

## Component tranches

The public package surface only exposes components that have passed the
standalone SSR, behavior, styling, and migration checks:

- Actions: buttons, menus, context menus, filter/select chips, spotlight
  search, copy, remove, and segmented controls
- Inputs: text, number, checkbox and switch controls; select, combobox,
  multi-select, tags, icons, PIN, slider, color, and date/time pickers;
  dropzones, image selection/cropping, completion-aware plain text,
  Markdown, and template editors
- Layout: `AppOverview`, `DataPanel`, `PanelHeader`, `PanelDialog`,
  `SettingsModal`, `AppWorkspace`, `Panes`, `FloatingWindow`, and generic
  settings-form helpers
- Surfaces: `Avatar`, `LinkCard`, `StatGrid`, `StatCell`, `StatusBadge`,
  `ProgressBar`, `NoticeCard`, `NoticeGrid`, `Placeholder`, `NotFoundState`
- Feedback: the complete scoped prompt family, `Tooltip`, and scoped `toast`
- Content: data and log tables, charts and interactive state timelines,
  calendars, file trees/browsers/previews, lightboxes, PDF previews,
  documentation primitives, pagination, range navigation, code and Markdown
  views, and structured-data previews
- Widgets: `Widget`, `WidgetCard`, `WidgetHero`, `WidgetList`, `WidgetPills`,
  `WidgetStat`, and `WidgetStatus`

`MarkdownView` renders trusted, pre-rendered HTML. Consumers must sanitize
untrusted Markdown before passing it to this presentation component.

Components use direct controlled values and small callback contracts:

```tsx
const [date, setDate] = createSignal<string | null>(null);

<DatePicker label="Release date" value={date()} onValueChange={setDate} />;
```

The package does not read Cloud routes, services, permissions, or application
state. Product-specific composition stays with the consuming application.

Composition components intentionally use semantic data instead of application
stores:

```tsx
<Widget title="Platform health" icon="ti ti-heartbeat">
  <WidgetStatus title="Operational" tone="success" />
  <WidgetPills items={[{ label: "Checks", value: 48, tone: "success" }]} />
</Widget>
```

## Catalog groups

The source tree and component documentation use the same groups as the Cloud
UI showcase: AI, Inputs, Actions, Layout, Surfaces, Feedback, Content, and
Widgets. Cloud-specific integrations are intentionally not part of this
package.

The AI presentation family is still planned. It is deliberately absent from
the root export until its full contract is implemented and tested.

`Panes` is a controlled, serializable layout for IDE-like workspaces. The
package owns tabs, nested splits, resize and drag-and-drop; applications own
pane content, open and close behavior, routing, and persistence:

```tsx
const ids = ["result", "query"];
const [layout, setLayout] = createSignal(createPanesValue(ids));

<Panes.Root value={layout()} onChange={setLayout}>
  <Panes.Element id="result" title="Result" icon="ti ti-table">
    <ResultView />
  </Panes.Element>
  <Panes.Element id="query" title="Query" icon="ti ti-code">
    <QueryEditor />
  </Panes.Element>
</Panes.Root>;
```

Pass persisted input through `normalizePanesValue(stored, ids)`. It accepts
legacy versionless values defensively and always returns the current versioned
shape.

Cloud stays on its existing UI until this package is complete. The
[migration inventory](./MIGRATION.md) records the generic, Cloud-specific, and
deprecated boundaries without compatibility shims.

The first external acceptance consumer is the Fibel component showcase. It
will move after the package is verified, before the Cloud big-bang migration.
That order proves CSS isolation, SSR/hydration, asset imports, theme overrides,
and public API ergonomics outside the Cloud shell.
