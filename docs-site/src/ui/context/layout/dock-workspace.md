# DockWorkspace

> **Deprecated:** Do not use `DockWorkspace` for new work. Use `Panes` inside `AppWorkspace.Main`.

`DockWorkspace` is the legacy result-and-docked-pane shell used by existing Pulse screens. It remains exported so those screens keep working.

## Use DockWorkspace

Use it only when changing an existing screen that already stores `DockWorkspaceState`.

Use `Panes` for every new resizable or tabbed workspace. `Panes` has the current controlled layout model and explicit element ids.

## Import

```tsx
import {
  DockWorkspace,
  type DockWorkspaceState,
} from "@valentinkolb/cloud/ui";
```

## Legacy state

`DockWorkspace.Result` defines the primary result. Each `DockWorkspace.Pane` has a stable `id` and an optional `section`.

`storageKey` identifies the legacy persistence cookie. `initialState` lets the server render the stored geometry.

Do not introduce new state adapters or persistence around this component. Migrate the screen to `Panes` when its layout behavior changes substantially.

## Accessibility

Keep pane titles concise. Existing resize controls expose separator labels, but the workspace must remain usable in its default arrangement.

## Runtime

The shell renders an initial state on the server and manages tabs, resizing, and its legacy cookie in the browser.

## Example

```tsx
// Legacy screen only. New work uses Panes.
<DockWorkspace storageKey="pulse.requests" initialState={storedState}>
  <DockWorkspace.Result title="Result" icon="ti ti-chart-line">
    <RequestChart />
  </DockWorkspace.Result>
  <DockWorkspace.Pane
    id="query"
    section="editor"
    title="Query"
    icon="ti ti-code"
  >
    <QueryEditor />
  </DockWorkspace.Pane>
</DockWorkspace>
```
