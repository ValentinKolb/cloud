# Empty States

`Placeholder` explains an empty, loading, or failed region inside a page.
`NotFoundState` handles a whole-page dead end and can provide one route back.

The application owns the message and any recovery action.

## Use empty states

Use `Placeholder` for an empty table, loading panel, or section that failed to
load. Use the compact variant inside a section and the panel variant for a
whole work area.

Use `NotFoundState` when a requested page or resource cannot be shown. Display
a code such as `404` only when it accurately describes the result.

## Import

```tsx
import {
  Button,
  NotFoundState,
  Placeholder,
} from "@k2b/ui";
```

## Properties

### Placeholder

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `title` | `JSX.Element` | none | Names the state. |
| `description` | `JSX.Element` | `children` | Explains the state or next step. |
| `children` | `JSX.Element` | none | Supplies the description when `description` is absent. |
| `icon` | `string` | `loading` and `error` only | Overrides the Tabler icon class. `state="empty"` renders no icon unless one is passed. |
| `action` | `JSX.Element` | none | Adds a recovery or creation action. |
| `state` | `"empty" \| "loading" \| "error"` | `"empty"` | Selects state semantics and default icon. |
| `variant` | `"compact" \| "panel"` | `"compact"` | Chooses section spacing or a larger work-area treatment. |
| `surface` | `"none" \| "paper"` | `"none"` | Adds the shared paper surface. |
| `align` | `"center" \| "left"` | `"center"` | Aligns the content. |
| `class` | `string` | none | Adds classes to the root element. |

An error state uses `role="alert"`. A loading state uses `role="status"`,
`aria-live="polite"`, and `aria-busy="true"`. The loading icon stops spinning
when reduced motion is requested. Placeholder icons use color to communicate
state and never render a decorative background or border.

### NotFoundState

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `title` | `string` | required | States what cannot be shown. |
| `description` | `string` | none | Adds useful context without exposing internal errors. |
| `code` | `string` | none | Displays a large status code. |
| `icon` | `string` | none | Displays an icon when no code is set. |
| `action` | `{ label: string; href: string; icon?: string }` | none | Provides one navigation path out of the dead end. |

`NotFoundState` renders a `div`, not a `main`, so the page shell retains
ownership of landmarks.

## Accessibility

Write titles that distinguish an empty result from a failed request. Loading
text should name what is loading. Recovery actions should name the action
rather than say only “Retry”.

`NotFoundState` renders its title as an `h1`. Do not place another page-level
heading around it.

## Runtime

Both components render on the server. An anchor action works without
hydration; an island owns any callback-based action.

## Example

```tsx
<Placeholder
  surface="paper"
  title="No notes yet"
  description="Create the first note for this workspace."
  action={<Button size="sm" onClick={createNote}>Create note</Button>}
/>

<Placeholder
  surface="paper"
  state="loading"
  variant="panel"
  title="Loading notes"
/>

<Placeholder
  state="error"
  align="left"
  title="Notes unavailable"
  description="Reload the page to try again."
/>

<NotFoundState
  code="404"
  title="Application not found"
  description="The application may have moved or access may have changed."
  action={{ label: "Back to applications", href: "/apps" }}
/>
```
