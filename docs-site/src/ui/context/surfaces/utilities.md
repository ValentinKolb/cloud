# Surface Utilities

Cloud surface utilities provide the shared border, radius, spacing, and elevation rules for small pieces of application UI. They are CSS classes, so the element and its semantics remain owned by the application.

## Use surface utilities

Use a utility when the UI is structurally simple and no shared component owns the behavior.

Prefer a component when the element needs state, accessibility behavior, or a stable composition contract. In particular, use `PanelDialog` or `prompts` instead of building a complex dialog from `dialog-panel`.

## Import

```ts
import "@valentinkolb/cloud/ui/styles.css";
```

## Properties

These classes provide only the CSS behavior listed below. They do not add component state or element semantics.

### Surfaces and layout

| Class | Purpose |
| --- | --- |
| `paper` | Bordered application surface with the shared radius, background, and surface shadow. |
| `thumbnail` | Rounded, clipped media or icon container. Size and background stay with the caller. |
| `popup` | Floating surface with the shared border and floating shadow. Positioning stays with the caller. |
| `dialog-panel` | Centered, viewport-bounded dialog surface for a native `<dialog>`. |
| `app-cols` | Stacks children vertically, then switches to a horizontal layout at the large breakpoint. |
| `app-rows` | Vertical flex layout with the shared row gap. |

### Labels and detail rows

| Class | Purpose |
| --- | --- |
| `text-label` | Standard form or metadata label text. |
| `detail-row` | One compact line for an email address, phone number, URL, or simple fact. |
| `detail-row-icon` | Fixed-width leading icon inside `detail-row`. |
| `detail-row-label` | Truncated secondary label inside `detail-row`. |
| `detail-facts` | Two-column definition-list layout for compact key/value facts. |

`detail-facts` supplies the grid only. Use native `<dt>` and `<dd>` elements so the relationship between keys and values remains explicit.

### Input-style buttons

| Class | Purpose |
| --- | --- |
| `btn-input` | Base control with shared hover, focus, pressed, and disabled states. |
| `btn-input-sm` | Small control height and padding. |
| `btn-input-md` | Medium control height and padding. |
| `btn-input-active` | Selected treatment for an active control. |

Compose the base class with one size and, when applicable, the active modifier.

## Accessibility

CSS utilities do not add roles, labels, keyboard handling, or focus order. Keep native elements: links for navigation, buttons for actions, definition lists for facts, and `<dialog>` for dialogs.

Color and icons may support meaning, but visible text must state it.

## Runtime

These utilities need no JavaScript. They render in SSR output and respond to the document's light or dark theme through shared CSS variables and dark-mode rules.

## Example

```tsx
<div class="paper app-rows p-4">
  <p class="text-label">Contact</p>

  <a class="detail-row" href="mailto:team@example.org">
    <i class="ti ti-mail detail-row-icon" aria-hidden="true" />
    <span class="detail-row-label">Work</span>
    <span>team@example.org</span>
  </a>

  <button type="button" class="btn-input btn-input-md btn-input-active">
    Selected
  </button>
</div>
```
