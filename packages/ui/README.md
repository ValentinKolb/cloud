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

AI surfaces can use a distinct semantic treatment without changing the general
application accent:

```css
.k2b-ui {
  --k2b-ai-accent: #0891b2;
  --k2b-ai-accent-hover: #0e7490;
  --k2b-ai-border: #06b6d4;
  --k2b-ai-surface: #ecfeff;
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
  `ProgressBar`, `NoticeCard` (with `NoticeCard.Grid`), `Placeholder`,
  `NotFoundState`
- Feedback: the complete scoped prompt family, `Tooltip`, and scoped `toast`
- AI: controlled `ChatComposer`, scrolling `ChatTimeline`, `ChatMessage`,
  `ChatActivity`, and compact `ChatContextUsage`
- Content: data and log tables, charts and interactive state timelines,
  calendars, file trees/browsers/previews, lightboxes, PDF previews,
  documentation primitives, pagination, range navigation, code and Markdown
  views, and structured-data previews
- Widgets: `Widget`, `WidgetCard`, `WidgetHero`, `WidgetList`, `WidgetPills`,
  `WidgetStat`, and `WidgetStatus`

`MarkdownView` renders trusted, pre-rendered HTML. Consumers must sanitize
untrusted Markdown before passing it to this presentation component.

## Field contract

Form controls share one controlled contract. The same prop always has the same
meaning:

- `id`, `class`, `label`, `description`, `error`, `required`, and `disabled`
  describe the field around the control.
- Use a visible `label` whenever possible. If the surrounding UI already
  provides the label, use the native `"aria-label"` or `"aria-describedby"`
  props. A placeholder is never an accessible label.
- `value` accepts either a direct value or a Solid accessor.
- `onValueChange` reports every controlled edit.
- `onValueCommit` reports the value when the user finishes the edit: on blur
  or Enter for text-like controls, and on an explicit selection or Apply action
  for pickers.

```tsx
const [name, setName] = createSignal("");
const [date, setDate] = createSignal<string | null>(null);

<TextInput
  label="Project name"
  value={name}
  onValueChange={setName}
  onValueCommit={saveName}
/>
<DatePicker
  label="Release date"
  value={date}
  onValueChange={setDate}
  onValueCommit={saveReleaseDate}
/>
```

Select, date, combobox, tags, and text controls use the same field metadata,
ARIA wiring, disabled and invalid states, and stable one-border focus shell.
Control-specific props only describe genuinely different behavior. For
example, `Combobox` owns a transient search `query` and hands the selected
domain object to `onSelect`; `FileDropzone` and `ImageCropper` are action/editor
primitives rather than value fields.

The package does not read Cloud routes, services, permissions, or application
state. Product-specific composition stays with the consuming application.
`Avatar` is therefore an additive portable presentation adapter. It does not
migrate Cloud's routed `./misc/Avatar` source contract, which remains
Cloud-specific.

Composition components intentionally use semantic data instead of application
stores:

```tsx
<Widget title="Platform health" icon="ti ti-heartbeat">
  <WidgetStatus title="Operational" tone="ok" />
  <WidgetPills pills={[{ label: "Checks", value: 48, tone: "emerald" }]} />
</Widget>
```

## Catalog groups

The source tree and component documentation use the same groups as the Cloud
UI showcase: AI, Inputs, Actions, Layout, Surfaces, Feedback, Content, and
Widgets. Cloud-specific integrations are intentionally not part of this
package.

The chat family accepts portable data and callbacks. Applications keep their
protocol, persistence, tool rendering, approvals, and file storage:

```tsx
const [draft, setDraft] = createSignal("");

<ChatTimeline
  items={items()}
  hasMore={hasMore()}
  onLoadOlder={loadOlder}
/>
<ChatComposer
  value={draft()}
  onValueChange={setDraft}
  onSend={({ text, attachments }) => sendMessage(text, attachments)}
  models={models}
  selectedModelId={modelId()}
  onModelChange={setModelId}
  context={<ChatContextUsage usage={usage()} contextWindow={128_000} />}
/>;
```

Return `false` or throw from `onSend` to restore the controlled draft and
attachments; `onSteer` restores the draft it consumed. A synchronous throw and
a rejected promise are treated identically, and the failure is handed to
`onError` for user-facing reporting. Raw selected files are handed to
`fileSelection.onSelect`; storage and upload policy remain application-owned.
`ChatTimeline` requests older items through `hasMore`/`onLoadOlder` and keeps
the reader's position once they are prepended.

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

Cloud stays on its existing UI for component families that have not reached
the package-wide big bang. Chat already completed a hard cut: built-in
consumers compose these generic components with thin Cloud protocol adapters,
without compatibility shims or a duplicate Cloud chat component set. The
[migration inventory](./MIGRATION.md) records the remaining generic,
Cloud-specific, and deprecated boundaries.

The Fibel component showcase is the first external acceptance consumer. Its
portable pages import `@k2b/ui` directly, while Cloud API integrations remain
in a visibly separate section. It exercises the package boundary and public
API ergonomics outside the Cloud shell before the Cloud big-bang migration.
Neither the showcase nor `packages/ui/fixture` is a browser certification: the
fixture has an automated server-render and shipped-class check, but it does not
prove browser hydration or interaction. Treat it as a standalone package and
SSR smoke test, and see the acceptance sequence in [MIGRATION.md](./MIGRATION.md)
for the separate browser acceptance gate.

## Verification

```bash
bun run typecheck          # package sources
bun run test               # builds the stylesheet first, then runs every suite
bun run build              # dist/styles.css and the optional font/icon presets
bun run check:migration    # migration-inventory.json against both UI surfaces
bun run fixture:typecheck  # standalone consumer fixture
bun run fixture:build      # standalone SSR build, no Cloud CSS or runtime
```

Do not use bare `bun test` as the package verification command: several guards
compare rendered markup with `dist/styles.css`. The fixture render guard rejects
a missing or stale stylesheet so this mistake fails loudly, but `bun run test`
is the supported one-step command.

Three contracts are enforced by tests rather than convention, because each one
regressed silently during the extraction:

- `src/styles/class-contract.test.ts` — the package renders no class its own
  stylesheet cannot style, renders only `k2b-`-prefixed names, and claims no
  unprefixed name inside the `.k2b-ui` scope. `styles/entry.css` imports the six
  scoped source sheets; Tailwind `@reference` directives live in source sheets
  such as `index.css` and `content-parity.css` and emit no generic utilities, so
  a leftover utility class in markup styles nothing.
- `src/styles/focus-contract.test.ts` — at most one focus signal per selector
  and cascade context, box-shadow-only focus rings have a forced-colors outline
  fallback, and AI tokens stay inside AI surfaces.
- Per-group single-ownership tests — a selector may be declared in only one
  stylesheet. Two partial declarations of the same selector merge into a third
  geometry matching neither Cloud nor either source.
