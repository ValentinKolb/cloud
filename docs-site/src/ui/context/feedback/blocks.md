# Info Blocks

Info-block utilities present a short, non-blocking message inside the current page. The application owns the message, heading structure, and any action.

## Use info blocks

Use an info block when a message must remain visible near the content it affects.

Use a toast for transient feedback. Use a prompt when the user must acknowledge or decide before work continues. Use `NoticeCard` for an operational finding that belongs in a diagnostic summary.

## Import

```ts
import "@valentinkolb/cloud/ui/styles.css";
```

## Properties

Info-block classes select the semantic treatment. Content and native element attributes stay with the application.

### Variants

| Class | Meaning |
| --- | --- |
| `info-block-note` | Neutral supporting note. |
| `info-block-info` | Informational context. |
| `info-block-success` | Completed or successful outcome. |
| `info-block-warning` | A condition that needs attention before continuing. |
| `info-block-danger` | A destructive or high-risk condition. |
| `info-block-error` | Alias of the danger treatment for an error message. |

All variants share the same spacing, radius, and readable text treatment. The variant changes the semantic accent and outline.

## Content

Keep one main point in each block. Put the consequence before an action when the reader needs it to decide.

An icon may be included with a Tabler class. The utility tones descendant `.ti` icons to match the variant. Do not use an icon or color instead of explicit wording.

## Accessibility

Info blocks add no live-region role because they are intended for persistent page content. If a block appears in response to an asynchronous failure, the owning component must choose an appropriate `role="alert"` or move focus according to the interaction.

Use a heading only when the message needs more than one paragraph. Keep links and buttons as native elements.

## Runtime

Info blocks are CSS-only and render completely on the server. They follow the shared light and dark themes without JavaScript.

## Example

```tsx
<div class="info-block-warning">
  Publishing sends this update to every subscriber.
</div>
```
