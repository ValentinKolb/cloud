---
title: Frontend
navTitle: Overview
section: Frontend
order: 800
description: Choose the server-rendered and interactive frontend tools for a Cloud application.
tags: [frontend, ssr, solidjs]
updated: 2026-07-27
---

# Frontend

Cloud pages render on the server. Islands add browser behavior where a page
needs it.

The server owns result sets, permissions, and durable view state. The browser
owns user intent, transient interaction state, and API calls caused by that
intent.

## Choose the page shape

Start with:

- [SSR pages and routing](/docs/en/frontend/ssr-pages-and-routing) to render a
  route;
- [Layout and navigation](/docs/en/frontend/layout-and-navigation) to place it
  in Cloud;
- [Application shells](/docs/en/frontend/application-shells) to choose the
  shared content structure;
- [Islands and hydration](/docs/en/frontend/islands-and-hydration) when part of
  the page needs browser state.

Use the URL for filters, sorting, pagination, selection, and the active view.
See [URL state and navigation](/docs/en/frontend/url-state-and-navigation).

## Add browser behavior

- [Browser clients and mutations](/docs/en/frontend/browser-clients-and-mutations)
  covers typed API calls and writes.
- [Realtime UI](/docs/en/frontend/realtime-ui) adds live updates to an
  SSR-owned result set.
- [Forms, prompts, and feedback](/docs/en/frontend/forms-prompts-and-feedback)
  covers user input and mutation states.

Finish with [Styling and accessibility](/docs/en/frontend/styling-and-accessibility)
and [Frontend testing](/docs/en/frontend/testing).

## Choose shared components

Use the [UI catalog](/ui) to inspect supported components, props, and live
examples. Shared components carry accessibility, responsive behavior, theming,
and platform vocabulary.

Compose them in an application-owned island when the UI needs domain state or
typed API calls. Keep domain-specific components in the application. Promote a
component only when several applications need the same behavior and contract.

If a recurring need is missing, improve the shared primitive and its catalog
example instead of hiding a local lookalike or CSS override.

Do not use `DockWorkspace` for new work. It remains only for compatibility.
