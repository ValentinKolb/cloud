# Getting started

`@k2b/ui` provides opinionated, production-ready Solid components for `@k2b/ssr` applications. The package includes accessible interaction patterns, scoped styles, and a configurable theme without tying your project to a specific product.

## Install

Add the package to an existing Solid project:

```bash
bun add @k2b/ui
```

`solid-js` and `@k2b/ssr` are peer dependencies. Install them as well when the project does not already provide them.

## Load the styles

Import the component stylesheet once from your application entry point:

```ts
import "@k2b/ui/styles.css";
```

The stylesheet only applies below `.k2b-ui`, so it does not reset the surrounding page. Add the class to the application root or to the subtree that renders UI components:

```tsx
import { createSignal } from "solid-js";
import { Button, TextInput } from "@k2b/ui";

export function ProfileForm() {
  const [name, setName] = createSignal("Ada");

  return (
    <main class="k2b-ui">
      <TextInput label="Display name" value={name} onValueChange={setName} />
      <Button>Save profile</Button>
    </main>
  );
}
```

Portalled surfaces such as prompts, menus, and tooltips preserve the scope automatically.

## Fonts and icons

The default theme uses system fonts. IBM Plex and the bundled Tabler icon font are optional:

```ts
import "@k2b/ui/fonts/plex.css";
import "@k2b/ui/icons/tabler.css";
```

Omit either import when your application already provides its own font or Tabler icon assets.

## Theme the package

Override tokens on your scoped root. Components derive focus, selection, and action colors from the accent stack while retaining accessible light and dark surfaces:

```css
.product-ui {
  --k2b-font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --k2b-accent-50: #f5f3ff;
  --k2b-accent-100: #ede9fe;
  --k2b-accent-200: #ddd6fe;
  --k2b-accent-300: #c4b5fd;
  --k2b-accent-400: #a78bfa;
  --k2b-accent-500: #8b5cf6;
  --k2b-accent-600: #7c3aed;
  --k2b-accent-700: #6d28d9;
  --k2b-accent-800: #5b21b6;
  --k2b-accent-900: #4c1d95;
  --k2b-accent-950: #2e1065;
}
```

```tsx
<main class="k2b-ui product-ui">...</main>
```

Most themes only need the font and accent stack. Override semantic tokens such as `--k2b-action`, `--k2b-surface`, `--k2b-text`, or `--k2b-border` when a specific role needs different treatment. See [Theme and styles](./surfaces/utilities) for the complete token reference.

## Solid and SSR

Import components directly from `@k2b/ui`. Package conditions select the SSR build on the server and the interactive build in the browser. State remains controlled by your application and continues seamlessly during hydration:

```tsx
import { createSignal } from "solid-js";
import { Tabs } from "@k2b/ui";

export function ProjectSections() {
  const [tab, setTab] = createSignal("overview");

  return (
    <Tabs ariaLabel="Project sections" value={tab} onValueChange={setTab}>
      <Tabs.Item value="overview" label="Overview">Overview content</Tabs.Item>
      <Tabs.Item value="activity" label="Activity">Activity content</Tabs.Item>
    </Tabs>
  );
}
```

## Package boundary

Every component in the portable catalog comes from `@k2b/ui`. Product-specific integrations live in a separate section when they depend on authenticated APIs, permissions, sessions, or other host contracts.
