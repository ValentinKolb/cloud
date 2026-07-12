# Notebook Script API

Read this reference when creating or changing trusted script blocks. It documents the complete script runtime exposed by Notebooks. For CLI workflows and the Notebooks content model, start with [Notebooks CLI](notebooks.md). For every available utility function, continue with [Notebook script utilities](notebooks-script-utilities.md).

## Contents

- [`current`](#current)
- [Named block views](#named-block-views)
- [`nb` notes](#nb-notes)
- [`nb.attachments`](#nbattachments)
- [`nb.tags`](#nbtags)
- [State APIs](#state-apis)
- [`ui`](#ui)
- [Script example](#script-example)

Scripts run inside trusted `script` code blocks. They have four globals and do not use imports:

- `current`: the note hosting the script.
- `nb`: the current notebook and its notes, tags, attachments, and local state.
- `ui`: rendered output and prompts.
- `std`: the complete utility API documented in [Notebook script utilities](notebooks-script-utilities.md).

Scripts can execute only when notebook scripts are enabled. Current-note writes are available in edit mode and throw in read mode. Scripts are trusted: `ui.html` and rendered Markdown are not sanitized.

## `current`

Read properties:

```ts
current.id: string
current.title: string
current.content: string
current.tags: string[]
current.notebook: { id: string; name: string }
current.createdAt: string
current.updatedAt: string
current.lockedAt: string | null
```

Edit-mode methods:

```ts
await current.setTitle(title)
await current.setContent(markdown)
await current.appendContent(markdown)
await current.prependContent(markdown)
await current.insertContentAt({ line, col? }, markdown) // zero-based
await current.replaceLine(line, text)                   // zero-based
```

## Named block views

The current note exposes writable views; notes returned by `nb` expose read-only views.

```ts
current.table(name)       // { name, columns, rows, add(...cells) } | undefined
current.tables(name?)
current.list(name)        // { name, items, add(...items) } | undefined
current.lists(name?)
current.todo(name)        // { name, items, add(...items) } | undefined
current.todos(name?)
current.data(name)        // { name, value, set(object) } | undefined
current.dataBlocks(name?)
current.section(name)     // { name, markdown, append(markdown) } | undefined
current.sections(name?)
```

Todo items are `{ done: boolean, content: string, line: number }`; `line` is zero-based. Table rows are `Record<string, string>`.

## `nb` notes

All operations are restricted to the current notebook.

```ts
await nb.list(): Promise<Note[]>
await nb.get(shortId): Promise<Note | null>
await nb.search(query: string | Query): Promise<Note[]>
await nb.searchTags(tags: string | string[], { limit?, offset? }?): Promise<Note[]>
await nb.create({ title, parentId?, content? }): Promise<Note>
await nb.update(shortId, { title?, parentId? }): Promise<Note>
await nb.remove(shortId): Promise<void>
```

Structured search is server-side and accepts:

```ts
type Query = {
  search?: string;
  tags?: string[];            // all tags must match
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  limit?: number;             // default 50, maximum 200
  offset?: number;
};
```

`nb.list()` is capped at 1,000 notes to protect the browser. Use paged `nb.search({ limit, offset })` calls when a script must process a larger notebook. `nb.remove()` deletes the addressed note through the notebook API; treat it as destructive.

A returned note has `id`, `title`, `content`, `tags`, `parentId`, `createdAt`, `updatedAt`, `lockedAt`, and the read-only named-block methods shown above. `id` is the note short id used by script APIs and note links.

## `nb.attachments`

```ts
await nb.attachments.list(): Promise<Attachment[]>
await nb.attachments.listInNote(): Promise<Attachment[]>
await nb.attachments.get(shortId): Promise<Attachment | null>
await nb.attachments.upload(fileOrBlob, filename?): Promise<Attachment>
await nb.attachments.uploadFromPicker({ accept?, multiple? }?): Promise<Attachment[]>
await nb.attachments.insertIntoContent(shortId): Promise<void> // edit mode
await nb.attachments.remove(shortId): Promise<void>
```

`Attachment` has `id`, `filename`, `mimeType`, `sizeBytes`, `kind: "image" | "file"`, and `createdAt`.

## `nb.tags`

```ts
await nb.tags.list(): Promise<Array<{ tag: string; count: number }>>
await nb.tags.notesForTag(tag): Promise<Note[]>
```

## State APIs

`current.kv` is collaborative per-note state synchronized between peers:

```ts
current.kv.get<T>(key): T | undefined
current.kv.set<T>(key, value | (current => next)): void
current.kv.delete(key): void
current.kv.keys(): string[]
current.kv.observe<T>(key, callback): () => void
```

`nb.localKV` is private per-user, per-notebook browser state and is asynchronous:

```ts
await nb.localKV.get<T>(key): Promise<T | undefined>
await nb.localKV.set<T>(key, value | (current => next)): Promise<void>
await nb.localKV.delete(key): Promise<void>
await nb.localKV.keys(): Promise<string[]>
nb.localKV.observe<T>(key, callback): () => void
```

Use `current.kv` for shared interactive state and `nb.localKV` for private UI preferences or caches. Neither replaces durable note content.

## `ui`

Every builder returns a normal `HTMLElement` with `.show()`. Mount with `ui.render(element)` or `element.show()`.

```ts
ui.row(...children)
ui.col(...children)
ui.card(...children)
ui.metric(label, value, { icon?, hint?, tone? }?)
ui.divider()
ui.text(content)
ui.heading(content, level?)
ui.md(markdown)
ui.noteLink(noteOrShortId, label?)
ui.noteList(notes, { emptyText? }?)
ui.table(rowsOrRecordsOrTableBlock, { columns?, emptyText? }?)
ui.chart(kind, options)
ui.button(label, onClick, { variant?, icon?, disabled? }?)
ui.html(rawHtml)
ui.live(() => childOrChildren)
ui.render(...children)
ui.toast(description, { variant?, duration?, iconClass?, title? }?)
```

`ui.live` re-runs its renderer when the current note body changes in edit mode and renders once in read mode. `ui.table` accepts row arrays, records, or a named table block; note values become note links, tag arrays become pills, and `ui.*` elements remain interactive cells.

Metric tones are `default`, `info`, `success`, `warning`, and `danger`. Button variants are `primary`, `secondary`, and `danger`. Chart `kind` is one of the functions under `std.charts`; its options are the same except width is measured by the container and `height` is a CSS-pixel option.

Prompts:

```ts
await ui.prompt.alert(message, { title?, icon? }?)
await ui.prompt.confirm(message, { title?, icon? }?): Promise<boolean>
await ui.prompt.text(message, defaultValue?, { title?, placeholder? }?): Promise<string | null>
await ui.prompt.form({ title?, icon?, submitText?, cancelText?, fields }): Promise<object | null>
```

Form field types are:

- `text`: `label`, `placeholder`, `required`, `default`, `multiline`, `lines`.
- `textarea`: `label`, `placeholder`, `required`, `default`, `rows` or `lines`.
- `number`: `label`, `placeholder`, `required`, `default`, `min`, `max`.
- `boolean`: `label`, `default`.
- `select`: `label`, `options`, `required`, `default`.

## Script example

```js
const recent = await nb.search({
  tags: ["project"],
  updatedAfter: new Date(Date.now() - 7 * 86400000).toISOString(),
  limit: 50,
});

ui.render(
  ui.metric("Active projects", recent.length, { icon: "ti ti-folder" }),
  ui.table(recent.map((note) => ({
    Project: ui.noteLink(note),
    Updated: std.dates.formatDateTimeRelative(note.updatedAt),
    Tags: note.tags,
  }))),
);
```
