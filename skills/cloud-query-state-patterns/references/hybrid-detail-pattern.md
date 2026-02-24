# Hybrid Detail Pattern (SSR + Client Selection)

## Goal

Keep SSR-first page load while opening details client-side without losing list scroll.

## Rules

1. SSR renders list page from URL state.
2. Selected entity ID is in URL query (`item`, `contact`, etc.).
3. Client selection updates URL via `history.replaceState`.
4. `popstate` restores UI state when navigating back/forward.
5. Detail panel open/close never forces full reload.

## Behavior Contract

- Deep link with selected ID opens same entity on initial SSR render.
- Clicking another row updates URL immediately.
- Closing detail clears selection keys.
- Scroll in list column remains stable.

## Optional UX

Use `document.startViewTransition(...)` when available, with fallback.

## Pattern Sources

- Detail panel helper:
  `cloud/packages/client/src/lib/browser/detail-panel.ts`
- Large-screen SSR + selected item behavior:
  `cloud/packages/apps/src/spaces/frontend/[id]/page.tsx`
