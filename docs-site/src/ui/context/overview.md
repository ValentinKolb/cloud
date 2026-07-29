# UI components

The portable component collection lives in the independent `@k2b/ui` npm package. It is opinionated around SolidJS, `@k2b/ssr`, Tabler icons, and scoped precompiled styles, but it does not depend on Cloud. Any Solid SSR project can install and use it.

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

The `.k2b-ui` scope prevents the package from resetting its host page. Fonts and the semantic color stacks are CSS variables, so applications can bring their own typography and theme without replacing component code. IBM Plex and Tabler are available as optional package assets.

## Portable components

The AI, Inputs, Actions, Layout, Surfaces, Feedback, Content, and Widgets sections document `@k2b/ui`. Every page renders the package component, shows its public import, and explains the contract the consuming application owns.

The package owns presentation and interaction primitives. The application continues to own domain data, URLs, persistence, authorization, uploads, AI protocols, and service calls.

The catalog is grouped by **the task a consumer is trying to complete**, not by the package's source folders. That keeps related tools together at the point of use: filters live with inputs, pagination with layout, calendars with surfaces, status vocabulary with feedback, and template editing with content. Source barrels remain an implementation detail and do not define the navigation.

## Cloud components

Exactly four catalog pages remain in `@valentinkolb/cloud` because their behavior depends on authenticated Cloud APIs or platform concepts:

- **Cloud assistant chat** — Cloud Assistant messages, tools, sessions, and attachments;
- **AI skills manager** — skill discovery and management backed by Cloud AI APIs;
- **Permissions and API keys** — identity, principal search, resource permissions, and scoped credentials;
- **Cloud dashboard widgets** — Cloud endpoint adapters feeding portable widget presentation.

These live in their own **Cloud components** section. A Cloud import on one of those pages is intentional; it is not a compatibility shim for `@k2b/ui`.

Deprecated wrappers such as `DateTimeInput` and `DockWorkspace` are not promoted in this collection.
