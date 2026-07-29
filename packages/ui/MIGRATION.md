# Cloud UI migration inventory

Cloud stays on `@valentinkolb/cloud/ui` for the remaining component families
until the package-wide big bang. Chat completed an earlier hard cut because its
generic package contract and Cloud protocol boundary are now explicit. There
are no compatibility re-exports.

[`migration-inventory.json`](./migration-inventory.json) covers the public
exports of both `packages/cloud/src/ui/index.ts` and
`packages/cloud/src/ai/ui.tsx`.

- `generic`: belongs in `@k2b/ui`, grouped like the component catalog;
- `cloudSpecific`: keeps a real Cloud runtime or domain contract;
- `deprecated`: must not be promoted into the new package.

`implemented` is intentionally strict. Every entry names an existing
package-relative concrete `target` module and focused `test`. The checker
resolves named and wildcard re-exports and requires the target to expose every
public source export. An explicit `exportMap` records a deliberate Cloud name
to canonical package name mapping; it never creates a compatibility export. A
smaller component with a similar name is still `planned`.
This source-and-test evidence is not browser certification: interaction,
responsive, theme, and hydration checks remain an explicit acceptance gate.

The currently checker-accepted source migrations are:

- actions: `FilterChip`, `SegmentedControl`, `ContextMenu`, `CopyButton`,
  `Dropdown`, `RemoveButton` (Cloud source: `RemoveBtn`), `SpotlightSearch`;
- inputs: `Checkbox`, `CheckboxCard`, `Switch`, `Select`, `Combobox`,
  `MultiSelectInput`, `SelectChip`, `TagsInput`, `DatePicker`,
  `DateTimePicker`, `DateRangePicker`, `PinInput`, `Slider`, `ColorInput`,
  `TextInput`, `NumberInput`, `IconInput`, `FileDropzone`, `ImageInput`,
  `ImageCropper`, `AutocompleteEditor`, `MarkdownEditor`, `TemplateEditor`,
  the generic completion kernel, and image-crop helpers;
- layout: `admin-settings`, `AppOverview`, `DataPanel`, `PanelDialog`,
  `PanelHeader`, `SettingsModal`, `AppWorkspace`, `Panes`, and
  `FloatingWindow`;
- surfaces: `LinkCard`, `NotFoundState`, `NoticeCard`, `Placeholder`,
  `ProgressBar`, `StatCell`, `StatGrid`, `StatusBadge`;
- feedback: `dialog-core`, `prompts`, `toast`, `Tooltip`.
- content: `Calendar`, `Chart`, `CodeDisplay`, `DataTable`, `Docs`,
  `FileBrowser`, `FileTree`, `FileView`, `Lightbox`, `LogEntriesTable`,
  `MarkdownView`, `Pagination`, `PdfPreview`, `RangePicker`,
  `StructuredDataPreview`, `chart-state-timeline`;
- widgets: `Widget`, `WidgetCard`, `WidgetHero`, `WidgetList`, `WidgetPills`,
  `WidgetStat`, `WidgetStatus`.

The chat family is deliberately absent from that source-migration list.
`migration-inventory.json` has no `ai` group: `ChatComposer`, `ChatTimeline`,
`ChatMessage`, `ChatActivity`, and `ChatContextUsage` are additive portable
components rather than renamed Cloud sources. Every remaining export of
`packages/cloud/src/ai/ui.tsx` is a Cloud-owned protocol adapter.

The generic chat family is additive rather than a rename of Cloud's AI
composite. It owns controlled composition, portable attachments, slash
commands, model selection, send/steer/stop states, conversation scrolling,
history loading, generic message/activity presentation, and context usage.
It deliberately knows nothing about Cloud sessions, stored messages, tools,
approvals, files, permissions, persistence, or routes.
The earlier experimental `packages/ui/src/ai` composites were unexported,
unimported subsets of the shipped chat family and have been deleted. The
`--k2b-ai-*` design tokens stay in `styles/index.css` because the shipped chat
family and the settings save-bar AI variant consume them.

The completed `Panes` migration keeps content and persistence app-owned while
providing a versioned, defensively normalized layout tree, deterministic node
ids, nested splits, tabs, stack presentation, resize, drag-and-drop, keyboard
navigation, and accessible announcements.

Cloud-owned controllers and domain contracts remain outside the package. This
includes permission and principal editors, resource API keys, workflow
authoring, stored AI protocols/controllers, timeline projection, action
bindings, and composer payload adapters. Cloud's `./misc/Avatar` source also
stays Cloud-specific because it owns an accounts route. The package `Avatar`
is an additive portable presentation adapter; it does not claim migration of
that routed source contract.

`Button` and `IconButton` are additive package foundations. Cloud has no
single public source module with the same contract, so they are intentionally
not migration-inventory entries. `Button` owns the package's canonical
variant, size, loading, disabled, and native-button behavior. `IconButton`
adds a required accessible `label` while retaining the same button contract.
Other package components compose these foundations instead of preserving
Cloud-local button wrappers.

Run `bun run check:migration` from `packages/ui` after changing either source
surface. The check follows barrel exports and fails for missing, stale, or
duplicate classifications.

## Acceptance sequence

1. Complete source parity and focused package evidence for `@k2b/ui`.
2. Migrate the Fibel component showcase as the first external consumer. Done:
   portable pages import `@k2b/ui` directly and Cloud API integrations live in
   a separate catalog section.
3. Done on 2026-07-29: browser-certify `packages/ui/fixture` in light, dark,
   desktop, and 390 px layouts, including hydration and controlled input,
   select, theme, tooltip, toast, and structured-data interactions. The Fibel
   pass covered all 57 catalog pages at desktop width with successful responses,
   no console errors or warnings, no failed assets, and no document overflow;
   representative narrow layouts covered every catalog group. Focus stability,
   keyboard menus, async combobox sizing and selection, date selection,
   `TagsInput` height, pane navigation, floating-window drag after resize,
   chart controls, calendar navigation, image-crop presets, icon selection,
   prompt dialogs, and file actions/edit/save were exercised directly. The
   source-level class contract remains the regression guard for standalone
   styling.
4. Done: fix package boundaries and APIs found by that migration, including
   standalone Calendar styles, namespaced toast ownership, single-layer
   editor focus treatment, and isolated Cloud-only showcase CSS.
5. Done for chat: migrate Assistant and both showcases in one hard cut, then
   remove the duplicate Cloud chat presentation components. The remaining
   Cloud UI families still wait for the package-wide big bang.

## Intentional divergences from Cloud

Generic components otherwise track Cloud's behaviour and appearance. These are
the deliberate exceptions, kept because a Cloud-specific dependency had to go or
because the package owns a contract the application used to own.

Package-wide:

- **Field contract.** Every form control uses the same `FieldProps` metadata:
  `id`, `class`, `label`, `description`, `error`, `required`, `disabled`, and
  native ARIA naming. Controlled fields add `value`, `onValueChange`, and
  `onValueCommit`; `value` accepts a direct value or Solid accessor. Atomic
  choices report both callbacks, while text-like controls change during input
  and commit on blur or Enter. The shared `internal/field` shell owns label,
  description, error, and ARIA relationships instead of Cloud's
  `InputWrapper`. The old per-control callback and naming aliases are
  intentionally unsupported.
- **Tokens.** `--k2b-*` is a remap of Cloud's `--ui-*`, not a copy. Class names
  the package does not own are limited to three families: `cd-*` from the
  package's own code highlighter, and `md-*` plus `stdlib-chart-*` emitted by
  `@k2b/stdlib`, which cannot be renamed without forking it.

Component-specific:

- `Dropdown` measures and clamps its menu in JavaScript instead of using Cloud's
  CSS anchor positioning, and its `width` prop is a CSS length rather than a
  utility class name — the package ships no utilities for a consumer to name.
- `ContextMenu` makes its host focusable to support the ContextMenu key and
  Shift+F10, and dismisses on a press inside the host. Cloud's is pointer-only
  and stays open. Both are commented at the call site.
- `DatePicker` uses `popover="auto"` with measured placement instead of Cloud's
  `<dialog>.showModal()` plus `document.documentElement` class syncing, and its
  trigger is a real `<button>` rather than a `<button>` nested inside a
  `<div role="combobox">`.
- The Markdown editor anchors its completion popover to the caret. Cloud queries
  an anchor attribute its overlay never emits, so Cloud always anchors to the
  whole textarea.
- `Panes` adds deterministic node ids and tablist semantics on top of Cloud's
  layout model. It deliberately keeps one full-size, non-scrolling panel wrapper
  instead of Cloud's `display: contents` body so `tabpanel`/`region` roles and
  their ARIA relationships survive; pane content still owns scrolling.
- `Avatar` and the chat family are additive rather than migrations; see above.

Inherited from Cloud and deliberately **not** changed, because changing them
would create a new divergence rather than remove one:

- The icon-prop contract is not uniform. `Widget`, `StatCell`, `NoticeCard`,
  `Select` and `FilterChip` take a complete class (`"ti ti-user"`), while
  `Docs`' `DocConceptGrid`/`DocRows` and `Combobox` prepend `ti ` themselves and
  expect a bare class name (`"ti-user"`). `WidgetCard` is a third contract: it
  prepends `ti ti-` and therefore expects only the glyph name (`"user"`). Cloud
  uses the first two shapes exactly the same way at
  `misc/Docs.tsx:106,123` and `input/Combobox.tsx:335`. Passing the wrong shape
  can emit a duplicate class or an invalid glyph name without a type error,
  which is why both the showcase and the reference docs had it wrong.
- `TagsInput` has no paste handler, no per-tag remove control and no
  backspace-removes-last. Tags are committed on blur or Enter and deduplicated;
  the `removed` list exists only to feed the live region. Cloud's is identical.
  The catalog copy previously promised paste and removal and has been corrected.
- `Chart` sizes `kind: "stateTimeline"` from its row count while every other
  kind waits for the ResizeObserver. Cloud does the same at `misc/Chart.tsx:148`.
  Now documented in the component's docstring.

Known and accepted: `ChatMessage` timestamps and token counts format through
`Intl` with the ambient locale, so a server and browser in different locales
render different text until hydration. The `timeLabel` prop is the escape hatch;
pinning a locale inside the package would be worse.

## Completed Cloud chat cutover

The cutover has no compatibility shims:

1. `AiChatProjection` reactively projects `AiStoredMessage` and `AiActiveTurn`
   into `ChatTimelineItem[]` below `AiChatActionsProvider`. Tool calls,
   approvals, surveys, cards, shell output, and web results remain Cloud-owned
   JSX content.
2. `aiChatModelOptions`, `aiChatAttachments`,
   `aiComposerAttachmentRecords`, and `aiComposerSendInput` bridge the generic
   controlled composer contract to Cloud records in both directions.
3. `AiChatActionsProvider` binds retry, fork, approval, frontend-tool, and file
   behavior without introducing a second timeline or message shell.
4. Assistant, UI Lab, and Fibel compose the generic package components.
5. The former `AiComposer`, `AiMessageList`, and `AiContextIndicator` exports
   and implementations were removed after the final caller migrated.
6. Official AI documentation describes the generic presentation contract
   separately from Cloud's controller and protocol.

The Fibel showcase exercises the public package boundary outside the Cloud
shell. `packages/ui/fixture` is the authoritative standalone SSR and hydration
gate because it contains no Cloud stylesheet or runtime import. Focused package tests
continue to own deep interaction contracts such as keyboard commands,
attachments, send failure restoration, history loading, and scroll follow.
