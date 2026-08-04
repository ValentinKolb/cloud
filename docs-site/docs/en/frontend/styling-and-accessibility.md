---
title: Styling and accessibility
navTitle: Styling and accessibility
section: Frontend
order: 890
description: Extend Cloud's visual system without breaking themes, responsive layouts, or accessibility.
tags: [css, accessibility, themes]
updated: 2026-07-27
---

# Styling and accessibility

Use shared components and semantic tokens before adding application CSS. Read
the [shared component guidance](/en/docs/frontend#choose-shared-components)
before creating a local control.

Cloud owns the visual language for surfaces, controls, status, spacing,
responsive layout, light and dark themes, focus, and motion.

## Use semantic styling

Import the shared styles through the application build. Use existing utility
classes such as `paper`, `section`, `btn-primary`, `input`, `sidebar-item`, and
`focus-ui`.

Use `app-accent-text` and `app-accent-border` for the application's accent.
Do not hardcode the app color into local components.

Avoid fixed light backgrounds, black text, and arbitrary borders. They break
dark mode and app theming.

Do not copy the internal markup or CSS of a shared component.

## Responsive layout

Use `Layout`, `AppWorkspace`, dialogs, and shared sidebars for responsive
geometry.

Test narrow and wide viewports. Content must not depend on pointer hover.
Dialogs must fit the viewport and keep their primary actions reachable.

## Preserve keyboard and screen reader access

- Use native buttons for actions and anchors for navigation.
- Give icon-only controls an accessible name.
- Keep a visible focus state.
- Do not use color as the only status signal.
- Associate labels and errors with inputs.
- Keep heading order meaningful.
- Return focus when a dialog closes.
- Announce async changes when they are not otherwise visible.

Use the shared drag-and-drop primitive for keyboard movement and live
announcements. Do not rely on deprecated `aria-grabbed`.

## Use established status and feedback

Use `StatusBadge` for health and lifecycle state. Its tone carries the platform
meaning while the label uses domain wording.

Use `Placeholder` for loading, empty, and error states. A failed load must not
look like an empty collection.

Use `NoticeCard` for a finding that remains visible on the page.

## Verify both themes

Review every changed surface in light and dark mode. Check focus, disabled,
selected, hover, error, and empty states.

Use automated accessibility checks as a baseline, then complete the keyboard
flow manually. The [Frontend testing](/en/docs/frontend/testing) guide lists
the full verification pass.
