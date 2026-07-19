---
id: ui-lab-reference
title: Reference
icon: ti ti-book
description: How UI Lab pages map to exported Cloud UI primitives and implementation decisions.
order: 110
---

UI Lab is documentation by executable examples. The live component and the adjacent code block should stay aligned when a shared primitive changes.

## Page groups {icon="layout-list"}

:::reference
- **Inputs and actions:** Covers text, markdown, autocomplete, number, date, select, file, boolean, button, menu, and segmented-control patterns.
- **Layout and surfaces:** Covers AppWorkspace, Panes, settings surfaces, dialogs, access controls, pagination, papers, placeholders, cards, avatars, stats, and calendars.
- **Feedback and content:** Covers info blocks, badges, prompts, toasts, charts, data tables, code, structured data, media previews, templates, docs, and markdown.
- **Widgets:** Shows endpoint-driven WidgetResponse examples for dashboard cards and home-screen widgets.
:::

## Maintenance rules {icon="book-2"}

:::reference
- **Keep examples current:** When a shared primitive changes, update the live demo and its TSX example in the same change.
- **Prefer Cloud primitives:** Use shared components before creating app-local styling for common controls, tables, dialogs, cards, docs, and layout shells.
- **Document decisions in place:** Add notes to the relevant showcase when a component is deprecated, replaced, or intended only for compatibility.
:::

:::info Visibility
UI Lab is a component showcase. If a deployment should not expose it, the app container should not be started.
:::
