# DetailPanel

`DetailPanel` gives contextual inspectors one quiet content structure without
owning their surrounding drawer, workspace region, dialog, or domain state.

## Import

```tsx
import { DescriptionList, DetailPanel } from "@k2b/ui";
```

## Use DetailPanel

Place it inside `AppWorkspace.Detail` for persistent selection context, or in
another host when the same inspector content is reused. The host owns opening,
closing, sizing, and persistence. The application owns data, permissions,
mutations, and which sections are present.

`DetailPanel.Header` keeps identity and actions in one compact row. Optional
metadata sits beside the subtitle instead of competing with the title.
`DetailPanel.Body` is the single scrolling element and accepts a
`scrollPreserveKey`. Do not add a second full-height scroller inside it.

`DetailPanel.Section` is deliberately flat. It groups content through spacing
and a sentence-case title, not a card, divider, or decorative background. Pass
`actions` for a normal section. Set `collapsible` for secondary content; a
collapsible section uses native `details` behavior and therefore does not accept
header actions.

Sections accept arbitrary content. Use `DescriptionList layout="rows"` for
compact properties, normal shared inputs for a full form inspector, and the
appropriate shared list, table, notice, preview, or editor for specialized
content. Do not add domain variants such as `record`, `mail`, or `workflow` to
`DetailPanel`.

Use `DetailPanel.Action` for a full-width destination or command such as a
related record, attachment, or in-panel jump. Pass `href` for native link
semantics; omit it for a native button. `leading`, `title`, optional
`description`, and `trailing` keep row geometry and interaction states
consistent. Do not use it for static key-value data, comments, history, or form
fields.

## Accessibility

The header title is an `h2`; normal section titles are labelled `h3` headings.
Collapsible sections use a native `summary` with a visible focus indicator.
Every icon-only action and every control embedded in a description value still
needs its own accessible name. `DetailPanel.Action` keeps its visible title as
the accessible name and renders a real link or button.

## Runtime

The composition is server-renderable. Collapsible sections work without client
JavaScript. Interactive children keep their own hydration and state contracts.

## Example

```tsx
<AppWorkspace.Detail id="item" open={selectedId() !== null} width="md">
  <DetailPanel>
    <DetailPanel.Header
      title="Studio shelf"
      subtitle="Locations · version 2"
      meta={<StatusBadge tone="ok" label="Active" />}
      actions={<IconButton label="Close details"><i class="ti ti-x" aria-hidden="true" /></IconButton>}
    />
    <DetailPanel.Body scrollPreserveKey="location-detail">
      <DetailPanel.Section title="Fields">
        <DescriptionList
          layout="rows"
          size="sm"
          items={[
            { term: "Room", description: "Studio" },
            { term: "Quantity", description: "18" },
          ]}
        />
      </DetailPanel.Section>
      <DetailPanel.Section title="Related records">
        <DetailPanel.Action
          href="/app/grids/locations/records/st-02"
          leading={<i class="ti ti-building-warehouse" aria-hidden="true" />}
          title="Studio"
          description="Room · ST-02"
          trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
        />
      </DetailPanel.Section>
      <DetailPanel.Section title="History" collapsible>
        …
      </DetailPanel.Section>
    </DetailPanel.Body>
  </DetailPanel>
</AppWorkspace.Detail>
```
