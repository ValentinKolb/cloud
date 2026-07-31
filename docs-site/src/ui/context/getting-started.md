# Getting started

`@k2b/ui` is an opinionated SolidJS component package for `@k2b/ssr` projects. It does not require Cloud and can be installed from npm like any other package.

## Install

Install the UI package together with its peer dependencies:

```bash
bun add @k2b/ui @k2b/ssr solid-js
```

Inside the Cloud monorepo, workspace consumers use the local package instead:

```json
{
  "dependencies": {
    "@k2b/ui": "workspace:*"
  }
}
```

## Load the styles

Import the component stylesheet once in the application entry point or global stylesheet:

```ts
import "@k2b/ui/styles.css";
```

The styles are scoped. Add `k2b-ui` to the application root or to the subtree that uses the components:

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

Portalled surfaces such as prompts, menus, and tooltips carry the scope themselves. The owning application still needs to render the normal component subtree inside `k2b-ui`.

## Fonts and icons

The default font stack uses system fonts. IBM Plex and the bundled Tabler icon font are optional:

```ts
import "@k2b/ui/fonts/plex.css";
import "@k2b/ui/icons/tabler.css";
```

If the application already supplies Tabler icons or its own fonts, omit these imports.

## Theme the package

Override tokens on the same scope. Components derive their semantic colors from the accent stack and keep light and dark surfaces separate:

```css
.product-ui {
  --k2b-font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
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

```tsx
<main class="k2b-ui product-ui">...</main>
```

Use semantic tokens such as `--k2b-action`, `--k2b-surface`, `--k2b-text`, and `--k2b-border` when a role needs a deliberate override. The complete token example lives under [Theme and styles](./surfaces/utilities).

## Solid and SSR

Components are Solid components and can render during SSR. Import them normally from `@k2b/ui`; the package exposes SSR and browser builds through package conditions. Browser behavior attaches during hydration, so application state stays application-owned:

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

Everything in the portable catalog comes from `@k2b/ui`. The separate Cloud section documents integrations that intentionally stay in `@valentinkolb/cloud` because they depend on authenticated Cloud APIs, permissions, sessions, or application contracts.
