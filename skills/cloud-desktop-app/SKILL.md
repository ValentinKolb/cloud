---
name: cloud-desktop-app
description: >
  Build StuVe Cloud-style native desktop apps with the Cloud UI system, Electrobun, local SQLite data,
  optional Cloud sync, native dialogs/menus/notifications, and path-based client routing. Use this skill
  when creating or changing desktop apps, desktop app SDK APIs, or local-first app flows.
---

# Building Cloud Desktop Apps

Cloud desktop apps are local-first applications that use the same UI language as Cloud web apps, but run in a native shell.
They may sync with a Cloud instance, or stay fully offline.

Use the normal `cloud-app` skill for server-side Cloud web apps. Use this skill when the app runs as a desktop binary.

`packages/desktop-lab` is retained as an inactive experiment. It is intentionally outside the root Bun workspace, Docker builds, and standard verification. Do not treat it as a supported starter app or use it as proof that a fresh clone has a working native toolchain.

## Core API

App code imports the singleton desktop API:

```typescript
import { desktop } from "@valentinkolb/cloud/desktop";
```

Keep the API KISS:

- `desktop.sql` is the local SQLite access point.
- `desktop.dialog`, `desktop.message`, `desktop.notification`, `desktop.clipboard`, and `desktop.external` are imperative native actions.
- `desktop.window` contains native window actions.
- `desktop.tasks` triggers and inspects main-process background tasks from renderer code.
- `desktop.navigate`, `desktop.back`, and `desktop.forward` handle path navigation.
- Do not add repository/ORM wrappers unless a real second caller proves the abstraction.

## App Definition

Put native shell configuration in `defineDesktopApp`, not in runtime calls:

```typescript
import { defineDesktopApp } from "@valentinkolb/cloud/desktop";

export const desktopApp = defineDesktopApp({
  name: "Notes",
  identifier: "dev.stuve.notes",
  routing: "path",
  window: {
    width: 1100,
    height: 760,
    titleBar: "hidden-inset",
  },
  menu: [
    {
      label: "File",
      items: [
        { label: "New Note", action: "notes:new" },
        { type: "divider" },
        { role: "quit" },
      ],
    },
  ],
});
```

The top application menu is app-shell config. Context menus are UI/runtime behavior.

## Background Tasks

Use desktop lifecycle hooks for background work. They run in the Bun/native main process, not in a renderer window:

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
        retry: { attempts: 3, baseMs: 1_000 },
        run: async ({ signal, logger }) => {
          if (signal.aborted) return;
          logger.info("Sync tick");
        },
      });
    },
  },
});
```

Native main code starts the lifecycle once:

```typescript
import { startDesktopApp } from "@valentinkolb/cloud/desktop";
import { desktopApp } from "./desktop-app";

const appHandle = await startDesktopApp(desktopApp);
```

Expose `appHandle.bridge` in the app's native bridge. Renderer code calls:

```typescript
await desktop.tasks.submit("sync");
const status = await desktop.tasks.status("sync");
```

Keep it KISS: no renderer timers for reliable sync, no hidden queue abstraction. If crash-resume is required, persist pending work in `desktop.sql` and drain it from a lifecycle task.

## Local Data

Use `desktop.sql` directly for local SQLite. It is intentionally thin:

```typescript
desktop.sql`
  create table if not exists notes (
    id text primary key,
    title text not null
  )
`;

const notes = desktop.sql<{ id: string; title: string }>`
  select id, title from notes order by title
`;
```

If Bun adds a new SQLite feature, prefer `desktop.sql.db` over wrapping it.

## Routing

Use path routing for multipage desktop apps. Avoid hash routing unless a legacy static shell forces it.

```tsx
import { DesktopRouter, Route, Link } from "@valentinkolb/cloud/desktop/solid";

export default function App() {
  return (
    <DesktopRouter>
      <Route path="/" component={HomePage} />
      <Route path="/notes" component={NotesPage} />
      <Route path="/notes/:id" component={NotePage} />
      <Route path="/settings" component={SettingsPage} />
    </DesktopRouter>
  );
}

<Link href="/notes">Notes</Link>;
desktop.navigate("/settings");
```

The native shell and browser dev harness should serve `index.html` as fallback for unknown app paths. The renderer owns route matching.

## Desktop UI Components

Use components for UI-shaped behavior:

### DesktopWorkspace

Use `DesktopWorkspace` for native app shells. It is desktop-specific: traffic lights stay in the full-height sidebar, the top bar is one continuous row from main to the right edge, and main/right/bottom panes can be independently enabled and resized. The workspace owns outer gutters and pane spacing; children should fill their slots. Keep the top bar flush with the content below it, add `gap-2`-sized gutters between content panes and at the right/bottom edge, and avoid borders between main/right/bottom/topbar. The sidebar may keep its own border.

```tsx
import { DesktopWorkspace } from "@valentinkolb/cloud/desktop/solid";

<DesktopWorkspace storageKey="notes" topBarHeight={44}>
  <DesktopWorkspace.Sidebar defaultSize={280} minSize={220} maxSize={420} resizable>
    {folderTree}
  </DesktopWorkspace.Sidebar>

  <DesktopWorkspace.TopBar drag>
    <DesktopWorkspace.DragRegion class="flex h-full select-none items-center px-3">
      <p class="text-sm font-semibold">Notes</p>
      <DesktopWorkspace.NoDrag class="ml-auto flex items-center gap-2">{actions}</DesktopWorkspace.NoDrag>
    </DesktopWorkspace.DragRegion>
  </DesktopWorkspace.TopBar>

  <DesktopWorkspace.Main>{editor}</DesktopWorkspace.Main>
  <DesktopWorkspace.Right defaultSize={320} resizable>{inspector}</DesktopWorkspace.Right>
  <DesktopWorkspace.Bottom defaultSize={160} resizable>{activity}</DesktopWorkspace.Bottom>
</DesktopWorkspace>
```

`TopBar drag` marks the whole top bar as a native window drag region. For custom chrome, or apps without a top bar/sidebar, wrap any draggable surface in `DesktopWorkspace.DragRegion` and wrap controls, inputs, links, editors, or menus in `DesktopWorkspace.NoDrag`:

```tsx
<DesktopWorkspace.DragRegion class="h-10 select-none px-3">
  <span>Floating tool</span>
  <DesktopWorkspace.NoDrag>
    <button class="btn-secondary btn-sm">Run</button>
  </DesktopWorkspace.NoDrag>
</DesktopWorkspace.DragRegion>
```

Keep it KISS: no docking, tabs, or floating panels in the primitive. Apps decide which slots exist, whether they are toggleable, and whether sizes persist via `storageKey`.

### ContextMenu

```tsx
import { ContextMenu } from "@valentinkolb/cloud/desktop/solid";

<ContextMenu>
  <ContextMenu.Trigger>
    <button type="button">Note</button>
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    <ContextMenu.Item onSelect={() => renameNote()}>Rename</ContextMenu.Item>
    <ContextMenu.Item destructive onSelect={() => deleteNote()}>Delete</ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu>
```

This keeps Linux/KDE support simple: native context menus can be an optimization, but the component must work with Cloud UI fallback.

## Native Actions

Use imperative APIs only for real OS actions:

```typescript
await desktop.dialog.openFile();
await desktop.message.info("Saved");
await desktop.notification.show({ title: "Notes", body: "Sync finished" });
await desktop.clipboard.writeText("hello");
await desktop.external.open("https://example.com");
```

Browser/dev harnesses should fail safely with clear unsupported-runtime errors.

## Cloud Sync

Desktop apps may be:

- local-only
- Cloud-connected with local cache
- Cloud-first with offline data

Use Cloud app credentials/API keys for Cloud-connected desktop sync. Do not use
admin tokens in production desktop flows, and do not store raw credentials after
the one-time token display.

## Verification

For shared desktop SDK changes, run the Cloud package check first. A maintained desktop app must additionally provide and run its own native build checks.

```bash
bun run --filter @valentinkolb/cloud typecheck
```

Also run Cloud boundary/cycle checks when exports or shared UI changed:

```bash
bun run check:boundaries
bun run check:cycles:core
```
