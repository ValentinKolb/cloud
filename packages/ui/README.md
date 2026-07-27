# @k2b/ui

Opinionated SolidJS components for `@k2b/ssr` applications. The package uses
semantic CSS variables, Tabler icon class names, and precompiled component
styles without a global reset.

```ts
import "@k2b/ui/styles.css";
import { AppWorkspace, Button, TextInput, StatusBadge, prompts } from "@k2b/ui";
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

The standalone package currently covers foundation and application composition:

- Actions: `Button`, `IconButton`, `CopyButton`, `SegmentedControl`
- Inputs: `TextInput`, `NumberInput`, `Checkbox`, `Switch`, `Select`
- Layout: `AppWorkspace`, `AppOverview`, `DataPanel`, `PanelHeader`, `PanelDialog`
- Surfaces: `Avatar`, `LinkCard`, `StatGrid`, `StatCell`, `StatusBadge`,
  `ProgressBar`, `NoticeCard`, `NoticeGrid`, `Placeholder`, `NotFoundState`
- Feedback: scoped dialogs and prompts, `Tooltip`, and scoped `toast`
- Content: the stdlib-backed `Chart`
- Widgets: `Widget`, `WidgetCard`, `WidgetHero`, `WidgetList`, `WidgetPills`,
  `WidgetStat`, and `WidgetStatus`

Components use direct controlled values and small callback contracts:

```tsx
const [name, setName] = createSignal("");

<TextInput
  label="Display name"
  value={name()}
  onValueChange={setName}
  description="Shown to other members."
/>;
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

Cloud stays on its existing UI until this package is complete. The
[migration inventory](./MIGRATION.md) records the generic, Cloud-specific, and
deprecated boundaries without compatibility shims.
