# Discussion

`Discussion` gives notes, comments, and short collaborative threads one portable visual and accessible structure. It owns the labelled surface, composer placement, author alignment, metadata rhythm, and progressive item actions. The application owns storage, permissions, loading, mutations, Markdown values, author identity, and domain copy.

## Import

```tsx
import { Discussion, IconButton, MarkdownEditor, MarkdownView, Tooltip } from "@k2b/ui";
```

## Use Discussion

Pass `label`, optional `icon`, `count`, and header `actions` to `Discussion`. Use `Discussion.Composer` for an editor plus its submit/cancel controls, `Discussion.List` for the ordered entries, and `Discussion.Item` for each author row. Put a single primary icon action in `insetAction` when it should sit inside the editor's lower-right corner; keep secondary or multiple controls in the `actions` footer.

The default root uses the same normal surface as `DetailPanel.Summary` and grouped sections. Set `surface="bare"` when the discussion is already placed in a page section and should not add another border, background, or layer of padding. Bare discussions use normal section-title typography; pass `as="h2"` when the discussion is a top-level page block. Author avatars and names stay deliberately compact so the discussion content remains the strongest visual element.

Keep long threads bounded at the application layer by adding a maximum height and vertical overflow to `Discussion.List`. The discussion heading and composer then remain visible without turning the whole discussion into a second page-level scroll owner.

## Example

```tsx
<Discussion
  label="Notes"
  icon="ti ti-note"
  count={`${notes().length} notes`}
  actions={<Button variant="ghost" size="xs">Add note</Button>}
>
  <Discussion.Composer
    onSubmit={postNote}
    insetAction={
      <Tooltip.Anchor content="Post note (Ctrl/Cmd+Enter)">
        <IconButton type="submit" label="Post note" disabled={!draft().trim()}>
          <i class="ti ti-send" aria-hidden="true" />
        </IconButton>
      </Tooltip.Anchor>
    }
  >
    <MarkdownEditor value={draft()} onValueChange={setDraft} noToolbar showStats={false} />
  </Discussion.Composer>
  <Discussion.List>
    <Discussion.Item
      avatar={<Avatar name="Mara Klein" size="xs" />}
      author="Mara Klein"
      timestamp={<time dateTime={note.createdAt}>18 min ago</time>}
      meta="edited"
      actions={<IconButton label="Note actions"><i class="ti ti-dots" /></IconButton>}
    >
      <MarkdownView markdown={note.content} headingScale="compact" />
    </Discussion.Item>
  </Discussion.List>
</Discussion>
```

`Discussion.Composer` is a native form. Its children remain application-selected, so a compact `MarkdownEditor`, another controlled editor, or an app-specific attachment control can be used without moving submission state into shared UI. An inset action is positioned over the editor without changing its outer geometry; `MarkdownEditor` content receives enough trailing space to remain readable. Disable empty submit actions and give icon-only actions an accessible `label` plus a shortcut tooltip.

`Discussion.Item` accepts application-rendered `avatar`, `author`, `timestamp`, `meta`, `replyContext`, and `actions` slots. Item actions are progressive by default: visible on touch, and revealed by hover or keyboard focus on fine pointers. Set `actionVisibility="always"` when an action must remain visible.

## Ownership

Do not pass domain records or mutation callbacks as a data model. Map them in the application and keep authorization there. Shared UI must not decide whether a person may create, edit, or delete a note.

## Accessibility

The root is a labelled `section`, the list is an ordered list, and the composer is a native form. Supply real `<time dateTime>` markup for timestamps and accessible names for every icon-only action. Progressive actions remain discoverable through keyboard focus and are never hidden on touch devices.

## Runtime

The structure is server-renderable. Interactive editors, buttons, and application state hydrate independently.
