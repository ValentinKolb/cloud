---
title: Component catalog
navTitle: Component catalog
section: Frontend
order: 910
description: Find supported shared UI components and understand when application code should use them.
tags: [components, ui, catalog]
updated: 2026-07-27
---

# Component catalog

Use the [UI catalog](/ui) to inspect shared Cloud components and their current
examples.

Use this guide to choose a component. The catalog owns exact props and visual
demonstrations.

## Start with structure

Choose a shell before individual controls:

- `AppOverview` for an application start page;
- `AppWorkspace` for resource work;
- `Panes` for an editor;
- `SettingsModal` for tabbed settings;
- `PanelDialog` for a complex modal editor;
- `DataPanel` for record collections;
- `StatGrid` for metrics.

See [Application shells](/docs/en/frontend/application-shells).

## Reuse platform behavior

Use shared components for:

- inputs and validation presentation;
- dialogs, prompts, and toasts;
- tables, pagination, filters, and search;
- status, progress, empty, and error states;
- access editors and resource API keys;
- calendars, code, Markdown, files, and PDF previews.

A shared component carries accessibility, responsive behavior, theming, and
platform vocabulary. Local lookalikes drift.

## Application-owned islands

The UI package exports components, not application islands.

Create an app-owned island when domain state and typed API calls are required.
Compose shared controls inside it.

Do not add a domain-specific component to the shared library. Promote a
component only when several applications need the same behavior and contract.

## Check the source when needed

If the catalog does not cover an exported component, inspect
`packages/cloud/src/ui` and at least one current caller before using it.

Do not use `DockWorkspace` for new work. It remains only for compatibility.

If a shared primitive cannot express a recurring requirement, improve that
primitive and its catalog example. Do not hide a local CSS override inside one
application.
