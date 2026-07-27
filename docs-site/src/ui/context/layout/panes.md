# Panes

`Panes` arranges peer tools as tabs, stacks, or resizable splits. The caller owns the complete layout value.

## Use Panes

Use it for query explorers, dashboard editors, report builders, and other workspaces where users move or split tools.

Use `AppWorkspace.MainPane` for a fixed list-and-reader layout. It provides shared geometry without making the application own a pane model.

## Import

```tsx
import {
  createPanesValue,
  normalizePanesValue,
  Panes,
  type PanesValue,
} from "@valentinkolb/cloud/ui";
```

## Own the layout

Create the initial value with `createPanesValue(ids, presentation)`. The presentation is `"tabs"` by default and can also be `"single"` or `"stack"`.

Pass the current `PanesValue` to `value` and replace it from `onChange`. Keep every `Panes.Element.id` stable.

Call `normalizePanesValue` when the available element ids change. It removes unavailable ids, keeps valid layout state, and adds new elements.

`allowResize`, `allowMove`, `allowReorder`, `allowHorizontalSplit`, and `allowVerticalSplit` default to `true`. Disable only the interactions the product does not support.

`keepMounted` defaults to `true`. Set it to `false` only when inactive pane content is safe to unmount.

Persist `PanesValue` only when restoring a user layout is a product requirement.

## Composition

Render `Panes` inside an edge-to-edge `AppWorkspace.Main`. Put padding and surfaces inside each element.

Use `closable` and `onClose` together. The caller must remove the element id and normalize the layout after closing it.

## Accessibility

Give each element a concise `title`. Move and close controls receive accessible labels from the title or id.

Pane movement is pointer-driven. Do not make a workflow depend on rearranging panes; the initial layout must remain usable.

## Runtime

`Panes` is controlled interactive Solid code and must be hydrated. The initial layout and pane contents can render on the server.

## Example

```tsx
const paneIds = ["result", "query", "schema"];
const [layout, setLayout] = createSignal<PanesValue>(
  createPanesValue(paneIds),
);

<Panes
  value={layout()}
  onChange={setLayout}
  allowResize
  allowMove
  allowReorder
>
  <Panes.Element id="result" title="Result" icon="ti ti-chart-line">
    <ResultView />
  </Panes.Element>
  <Panes.Element id="query" title="Query" icon="ti ti-code">
    <QueryEditor />
  </Panes.Element>
  <Panes.Element id="schema" title="Schema" icon="ti ti-database">
    <SchemaBrowser />
  </Panes.Element>
</Panes>;
```
