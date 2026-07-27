# Cloud UI

Cloud UI documents the shared components used by Cloud applications.

Choose a component by task. Each page shows the running component, its public import, and the contract between the component and its parent.

## Use Core UI

- Import components from the public `@valentinkolb/cloud/ui` package.
- Treat the repository examples as examples, not application defaults.
- Check the exported prop types before adding a wrapper or changing component behavior.

## Sections

- **Inputs** — fields, editors, pickers, uploads, and filters.
- **Actions** — buttons, menus, and focused action controls.
- **Layout** — application shells, panes, dialogs, settings, and navigation.
- **Surfaces** — cards, stats, operational panels, and calendars.
- **Feedback** — messages, statuses, toasts, tooltips, and prompts.
- **Content** — tables, charts, files, media, code, and rich content.
- **Widgets** — endpoint-driven dashboard blocks.

## Component pages

Each page contains:

1. the public import;
2. live examples from the repository;
3. rules for choosing and composing the component;
4. copyable TSX for the rendered state.

The same component context is available through search, raw `.md` routes, `llms.txt`, and the optional Fibel assistant.

## Scope

This catalog covers the public Core UI package. AI chat components live in their own package and will receive a separate catalog. Deprecated Core components remain visible for migration work but are not recommended for new screens.
