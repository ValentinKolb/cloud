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
- `desktop.tasks.submit(id)` / `status(id)` / `list()` — trigger and inspect main-process background tasks.
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

## Background Tasks

Run desktop background tasks in the Bun/native main process, not in a renderer window. Renderer windows may reload, close, or exist more than once; the app process owns reliable sync, scans, cleanup, and other background work.

Declare lifecycle hooks on `defineDesktopApp`:

```typescript
import { defineDesktopApp } from "@valentinkolb/cloud/desktop";

export const desktopApp = defineDesktopApp({
  name: "Notes",
  identifier: "dev.stuve.notes",
  lifecycle: {
    setup: async ({ sql }) => {
      sql`create table if not exists sync_state (key text primary key, value text)`;
    },
    start: async ({ tasks }) => {
      tasks.every("sync", {
        intervalMs: 60_000,
        runOnStart: true,
        retry: { attempts: 3, baseMs: 1_000, maxMs: 10_000 },
        run: async ({ signal, sql, logger }) => {
          if (signal.aborted) return;
          logger.info("Sync started");
          sql`insert or replace into sync_state (key, value) values (${"last_sync"}, ${new Date().toISOString()})`;
        },
      });
    },
  },
});
```

Boot the lifecycle once from the native main process:

```typescript
import { startDesktopApp } from "@valentinkolb/cloud/desktop";
import { desktopApp } from "../desktop-app";

const appHandle = await startDesktopApp(desktopApp);
```

Expose `appHandle.bridge` through the native bridge together with dialogs, windows, and filesystem APIs. Renderer code should use the singleton API:

```typescript
import { desktop } from "@valentinkolb/cloud/desktop";

await desktop.tasks.submit("sync");
const status = await desktop.tasks.status("sync");
const tasks = await desktop.tasks.list();
```

Task rules:

- Task ids are app-local strings such as `"sync"` or `"folders:scan"`.
- A task never overlaps with itself; submitting while it is running returns the current run.
- Use `signal` in long-running tasks so quit/restart can stop promptly.
- `retry` is for transient errors only. Permanent validation errors should fail and be visible in `desktop.tasks.status(id)`.
- Keep durable queues explicit. For crash-resume work, store pending items in `desktop.sql` and have a lifecycle task drain them.
