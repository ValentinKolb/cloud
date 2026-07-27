# Empty States

`Placeholder` explains an empty, loading, or failed region inside a page. `NotFoundState` handles a whole-page dead end and can provide one route back.

The application owns the message and any recovery action.

## Use empty states

Use `Placeholder` for an empty table, an unloaded panel, or a section that failed to load.

Use `NotFoundState` when the requested page or resource cannot be shown. Only display a code such as `404` when that code accurately describes the result.

## Import

```tsx
import {
  NotFoundState,
  Placeholder,
} from "@valentinkolb/cloud/ui";
```

## Properties

### Placeholder

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `title` | `JSX.Element` | none | Names the state. |
| `description` | `JSX.Element` | `children` | Explains the state or next step. |
| `children` | `JSX.Element` | none | Supplies the description when `description` is absent. |
| `icon` | `string` | state icon | Overrides the Tabler icon class. |
| `action` | `JSX.Element` | none | Adds a recovery or creation action. |
| `state` | `"empty" \| "loading" \| "error"` | `"empty"` | Selects state semantics and default icon. |
| `variant` | `"compact" \| "panel"` | `"compact"` | Chooses compact section spacing or a larger work-area treatment. |
| `surface` | `"none" \| "paper"` | `"none"` | Adds the shared paper surface. |
| `align` | `"center" \| "left"` | `"center"` | Aligns the content. |
| `class` | `string` | none | Adds classes to the root element. |

An error state overrides the icon treatment and uses `role="alert"`. A loading state uses `role="status"`, `aria-live="polite"`, and `aria-busy="true"`.

### NotFoundState

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `title` | `string` | required | States what cannot be shown. |
| `description` | `string` | none | Adds useful context without exposing internal errors. |
| `code` | `string` | none | Displays a large status code. |
| `icon` | `string` | none | Displays an icon when no code is set. |
| `action` | `{ label: string; href: string; icon?: string }` | none | Provides one navigation path out of the dead end. |

## Accessibility

Write titles that distinguish an empty result from a failed request. Loading text should name what is loading. Error actions should describe the recovery action rather than say only “Retry”.

`NotFoundState` renders its title as the page heading. Do not place another page-level heading around it.

## Runtime

Both components render on the server and need no hydration. An interactive `Placeholder` action belongs to the owning island; an anchor action remains functional in SSR output.

## Example

```tsx
<Placeholder
  surface="paper"
  variant="panel"
  icon="ti ti-notebook"
  title="No notes yet"
  description="Create the first note for this workspace."
  action={<a class="btn-primary btn-sm" href="/notes/new">Create note</a>}
/>

<NotFoundState
  code="404"
  title="Application not found"
  description="The application may have moved or access may have changed."
  action={{ label: "Back to applications", href: "/apps" }}
/>
```
