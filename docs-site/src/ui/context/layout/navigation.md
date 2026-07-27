# Navigation

`Link` adds optional client navigation to a real anchor. It does not provide route matching or load server data.

The application owns the URL, the next UI state, and the decision to update history or fall back to a document navigation.

## Use Link

Use `Link` inside an island when the island can update itself for the target URL and should avoid a full reload.

Use a normal anchor when the server must render the next page. Keep a real `href` in both cases.

## Import

```tsx
import {
  Link,
  type LinkNavigateEvent,
} from "@k2b/ssr/nav";
```

## Enhance a link

Without `onNavigate`, same-origin clicks use client history and preserve normal anchor behavior for modifier keys, downloads, external URLs, and other targets.

With `onNavigate`, update the island from `event.url`, then call one outcome:

- `event.push()` adds a history entry;
- `event.replaceWith()` replaces it;
- `event.fallback()` performs a document navigation.

If the handler throws, `Link` logs the error and falls back to document navigation.

`scroll` is `"top"` by default. Use `"preserve"` to retain window and keyed region positions. Use `"manual"` only when the application restores scroll itself.

## Preserve a region

Add a stable `data-scroll-preserve` value to a scrolling element. `AppWorkspace.SidebarBody` and `SidebarMobileBody` expose this through `scrollPreserveKey`.

Listen to Back and Forward with `listenPopState` when an island owns URL-backed state. Reconcile the island from the event URL.

## Accessibility

`Link` renders an anchor. Use meaningful link text and preserve native open-in-new-tab and modifier-click behavior.

Do not replace links with buttons only to avoid a reload.

## Runtime

The anchor renders during SSR and works before hydration. Enhanced navigation runs only in the browser.

The SSR route must render the same result for the target URL. Client navigation is an enhancement, not a separate application state.

## Example

```tsx
<Link
  href="/app/inventory?view=archived"
  scroll="top"
  onNavigate={async (navigation: LinkNavigateEvent) => {
    const next = await loadView(navigation.url);
    setItems(next.items);
    setView("archived");
    navigation.push();
  }}
>
  Archived items
</Link>
```
