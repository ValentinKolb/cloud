# Cloud Desktop App API Reference

Use `@valentinkolb/cloud/desktop` for runtime APIs:

- `defineDesktopApp(config)` — native app identity, window defaults, routing mode, app menu.
- `desktop.sql` — thin local SQLite tagged template for the Bun desktop process.
- `desktop.dialog.openFile()` — native file dialog.
- `desktop.message.show()` / `info()` / `warning()` / `error()` — native message boxes.
- `desktop.notification.show()` — native notification.
- `desktop.clipboard.readText()` / `writeText()` — system clipboard.
- `desktop.external.open(url)` — open URLs with the operating system.
- `desktop.window.close()` / `minimize()` / `maximize()` — native window controls.
- `desktop.navigate(path)` / `back()` / `forward()` — path-based client navigation.

Use `@valentinkolb/cloud/desktop/solid` for UI-shaped features:

- `DesktopRouter`, `Route`, `Link` — path routing for multipage renderer apps.
- `DesktopWorkspace` — native desktop shell with full-height sidebar, continuous top bar, main/right/bottom slots, draggable regions, and optional resizable panes.
- `ContextMenu` — component-based context menu with Cloud UI fallback.
- `TitleBar`, `WindowControls` — custom chrome building blocks.

`DesktopWorkspace` slots:

- `Sidebar` — full-height left pane; reserves a macOS traffic-light drag area by default.
- `TopBar` — one continuous top row spanning main + right to the window edge; pass `drag` to make it a window drag region.
- `Main` — center content.
- `Right` — optional inspector/detail pane.
- `Bottom` — optional panel spanning main + right.
- `DragRegion` / `NoDrag` — explicit native window drag and interactive zones.

Use `TopBar drag` for normal top bars. For custom chrome or apps without top/left bars, place `DesktopWorkspace.DragRegion` on any element that should move the native window, and wrap buttons, inputs, links, editors, and menus in `DesktopWorkspace.NoDrag` so they stay interactive. Prefer `select-none` on drag regions so dragging text does not select it.

Resizable panes accept `defaultSize`, `minSize`, `maxSize`, `resizable`, and `open`. Sizes persist when the root has `storageKey`.

Layout convention: the workspace owns all outer gutters and pane spacing; slot children should fill their available pane. Use `gap-2`-sized horizontal pane gaps and right/bottom gutters, keep the top bar flush with the content below it, and add a top gutter only when no top bar is present. The full-height sidebar may use a right border; topbar/main/right/bottom should not use borders as separators.
