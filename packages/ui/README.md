# @k2b/ui

Opinionated SolidJS components for `@k2b/ssr` applications. The package uses
semantic CSS variables, Tabler icon class names, and precompiled component
styles without a global reset.

```ts
import "@k2b/ui/styles.css";
import { AppWorkspace, Chart, Placeholder, prompts } from "@k2b/ui";
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
  --k2b-accent-500: #8b5cf6;
  --k2b-accent-600: #7c3aed;
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

## Catalog groups

The source tree and component documentation use the same groups as the Cloud
UI showcase: AI, Inputs, Actions, Layout, Surfaces, Feedback, Content, and
Widgets. Cloud-specific integrations are intentionally not part of this
package.
