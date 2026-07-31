# UI components

`@k2b/ui` is an opinionated component foundation for SolidJS and `@k2b/ssr`. It combines accessible interaction patterns, scoped precompiled styles, and configurable design tokens in a package that can be used across products.

```tsx
import "@k2b/ui/styles.css";
import { Button, Placeholder } from "@k2b/ui";

export function EmptyProject() {
  return (
    <main class="k2b-ui">
      <Placeholder title="No project selected" />
      <Button>Select project</Button>
    </main>
  );
}
```

The `.k2b-ui` scope keeps component styles isolated from the host page. Fonts and semantic color stacks use CSS variables, so each product can provide its own typography and visual identity. IBM Plex and Tabler icons are available as optional assets.

## Portable components

The AI, Inputs, Actions, Layout, Surfaces, Feedback, Content, and Widgets sections cover the portable package. Each reference page renders the real component, shows its public import, and explains which state and behavior remain application-owned.

The package owns presentation and reusable interaction behavior. Applications continue to own domain data, navigation, persistence, authorization, uploads, AI protocols, and service calls.

The catalog follows **the task a consumer is trying to complete**, not the package's source tree. Related tools therefore stay together at the point of use, while internal source barrels remain an implementation detail.

## Cloud components

Four integrations remain product-specific because their behavior depends on authenticated Cloud APIs or platform concepts:

- **Cloud assistant chat** — Cloud Assistant messages, tools, sessions, and attachments;
- **AI skills manager** — skill discovery and management backed by Cloud AI APIs;
- **Permissions and API keys** — identity, principal search, resource permissions, and scoped credentials;
- **Cloud dashboard widgets** — Cloud endpoint adapters feeding portable widget presentation.

They live in their own **Cloud components** section, keeping the portable package boundary explicit.

Deprecated wrappers such as `DateTimeInput` and `DockWorkspace` are not promoted in this collection.
