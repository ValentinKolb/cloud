# Notices

`NoticeCard` keeps an important finding visible between an ephemeral toast and a full empty or error state. `NoticeCard.Grid` arranges several findings without nested card chrome.

## Use notices

Use `neutral` for general notes, `info` for contextual information, `warning` for reviewable risk, and `danger` for a real failure. Keep the title specific and the detail actionable.

Use a toast for short confirmation. Use `Placeholder` when the finding replaces an entire content region.

## Import

```tsx
import { NoticeCard } from "@k2b/ui";
```

## Composition

`NoticeCard` accepts `title`, optional `detail`, `tone`, `icon`, and `class`.
`NoticeCard.Grid` receives an `items` array and a child renderer. It selects
one, two, or three responsive columns from the item count.

The component owns presentation only. Put retry, dismissal, and navigation controls beside the notice when they are needed.

## Accessibility

Notice cards add no live-region role. If a new error notice must be announced immediately, the owning application must provide the appropriate alert semantics. All tones keep visible text, so the result never depends on color or icon.

Action labels must say what happens next, such as **Retry** or **Open settings**.

## Runtime

Notice content renders on the server. Actions require hydration only when implemented as client callbacks.

## Example

```tsx
const notices = [
  { tone: "neutral", title: "Release note", detail: "Version 2.4 is available." },
  { tone: "info", title: "Import ready", detail: "Twelve records were validated." },
  { tone: "warning", title: "Review needed", detail: "Two records have no owner." },
  { tone: "danger", title: "Source unavailable", detail: "Retrying in the background." },
] as const;

<NoticeCard.Grid items={notices}>
  {(notice) => <NoticeCard {...notice} />}
</NoticeCard.Grid>
```
