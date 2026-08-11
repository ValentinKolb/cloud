---
title: Layout and navigation
navTitle: Layout and navigation
section: Frontend
order: 820
description: Place application pages in the shared Cloud layout and navigation.
tags: [layout, navigation, breadcrumbs]
updated: 2026-08-12
---

# Layout and navigation

Wrap every application page in `Layout` or `AdminLayout`.

The shared layout provides the header, breadcrumbs, app navigation, mobile
navigation, global search, theme control, and footer.

Layout owns Cloud chrome; an [application shell](/en/docs/frontend/application-shells)
owns the geometry inside it. Keeping those layers separate lets Cloud evolve
global navigation without taking ownership of an independently deployed app's
information architecture.

## Render the application layout

```tsx
<Layout
  c={c}
  title={[
    { title: "Inventory", href: "/app/inventory" },
    { title: item.name },
  ]}
>
  <ItemDetail item={item} />
</Layout>
```

The final breadcrumb has no link. A plain string is valid for a one-level
title.

Use `fullWidth` for a multi-column workspace. Use `fullPage` for a fill-height
surface without the footer.

Do not reproduce Cloud chrome inside application content.

## Register navigation

Application navigation comes from `defineApp()`:

```ts
nav: {
  href: "/app/inventory",
  match: "/app/inventory",
  section: "primary",
  requiresAuth: true,
  requiresRoles: ["user"],
}
```

`section` is `primary`, `more`, or `hidden`. The layout filters entries with
the current request identity.

The live app registry supplies the navigation. Do not hardcode links to every
other Cloud application.

## Render an admin page

```tsx
<AdminLayout c={c} title="Inventory">
  <h1 class="text-base font-semibold text-primary">
    Inventory
  </h1>
  <InventoryAdminPanel />
</AdminLayout>
```

`AdminLayout.title` sets breadcrumbs. The page renders its own heading.

App-owned admin groups come from `adminNav` in the application declaration.

## Use anchors for navigation

Navigation controls start as anchors with an `href`. A link must work before
hydration and support open-in-new-tab.

Use enhanced navigation only inside an island that also updates its own state.
See [URL state and navigation](/en/docs/frontend/url-state-and-navigation).
