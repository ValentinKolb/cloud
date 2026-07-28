# Cloud UI migration inventory

Cloud stays on `@valentinkolb/cloud/ui` until `@k2b/ui` is complete. There are
no compatibility re-exports and no incremental application migration.

[`migration-inventory.json`](./migration-inventory.json) covers the public
exports of both `packages/cloud/src/ui/index.ts` and
`packages/cloud/src/ai/ui.tsx`.

- `generic`: belongs in `@k2b/ui`, grouped like the component catalog;
- `cloudSpecific`: keeps a real Cloud runtime or domain contract;
- `deprecated`: must not be promoted into the new package.

`implemented` is intentionally strict. It means the complete public contract,
behavior, accessibility, responsive behavior, and required styling exist in
`@k2b/ui` and are covered by a focused test. A smaller component with a similar
name is still `planned`.

The currently accepted complete migrations are:

- actions: `FilterChip`, `SegmentedControl`, `ContextMenu`, `CopyButton`,
  `Dropdown`, `RemoveBtn`, `SpotlightSearch`;
- inputs: `Checkbox`, `CheckboxCard`, `Switch`, `Select`, `Combobox`,
  `MultiSelectInput`, `SelectChip`, `TagsInput`, `DatePicker`,
  `DateTimePicker`, `DateRangePicker`, `PinInput`, `Slider`, `ColorInput`,
  `TextInput`, `NumberInput`, `IconInput`, `FileDropzone`, `ImageInput`,
  `ImageCropper`, `AutocompleteEditor`, `MarkdownEditor`, `TemplateEditor`,
  the generic completion kernel, and image-crop helpers;
- layout: `admin-settings`, `AppOverview`, `DataPanel`, `PanelDialog`,
  `PanelHeader`, `SettingsModal`, `AppWorkspace`, `Panes`, and
  `FloatingWindow`;
- surfaces: `Avatar`, `LinkCard`, `NotFoundState`, `NoticeCard`, `Placeholder`,
  `ProgressBar`, `StatCell`, `StatGrid`, `StatusBadge`;
- feedback: `dialog-core`, `prompts`, `toast`, `Tooltip`.
- content: `Calendar`, `Chart`, `CodeDisplay`, `DataTable`, `Docs`,
  `FileBrowser`, `FileTree`, `FileView`, `Lightbox`, `LogEntriesTable`,
  `MarkdownView`, `Pagination`, `PdfPreview`, `RangePicker`,
  `StructuredDataPreview`, `chart-state-timeline`;
- AI: `ChatComposer`, `ChatTimeline`, `ChatMessage`, `ChatActivity`, and
  `ChatContextUsage`;
- widgets: `Widget`, `WidgetCard`, `WidgetHero`, `WidgetList`, `WidgetPills`,
  `WidgetStat`, `WidgetStatus`.

The generic chat family is additive rather than a rename of Cloud's AI
composite. It owns controlled composition, portable attachments, slash
commands, model selection, send/steer/stop states, conversation scrolling,
history loading, generic message/activity presentation, and context usage.
It deliberately knows nothing about Cloud sessions, stored messages, tools,
approvals, files, permissions, persistence, or routes.
Experimental files under `packages/ui/src/ai` stay excluded from the package
manifest and are not part of this contract.

The completed `Panes` migration keeps content and persistence app-owned while
providing a versioned, defensively normalized layout tree, deterministic node
ids, nested splits, tabs, stack presentation, resize, drag-and-drop, keyboard
navigation, and accessible announcements.

Cloud-owned controllers and domain contracts remain outside the package. This
includes permission and principal editors, resource API keys, workflow
authoring, stored AI protocols/controllers, profile-specific avatar writes,
and the existing `AiComposer`/`AiMessageList` protocol composites.

Run `bun run check:migration` from `packages/ui` after changing either source
surface. The check follows barrel exports and fails for missing, stale, or
duplicate classifications.

## Acceptance sequence

1. Complete and verify `@k2b/ui` through its standalone `@k2b/ssr` fixture.
2. Migrate the Fibel component showcase as the first external consumer.
3. Fix package boundaries or APIs found by that migration in the package.
4. Migrate Cloud and all built-in apps in one hard cut.

## Future Cloud chat cutover

Do not add compatibility shims. During the Cloud big bang, add a thin
Cloud-owned adapter and update every consumer together:

1. Project `AiStoredMessage`, `AiActiveTurn`, and the existing timeline model
   into `ChatTimelineItem[]`. Tool calls, approvals, surveys, cards, shell
   output, and web results remain Cloud-owned JSX passed as message or activity
   content.
2. Map Cloud model profiles to `ChatModelOption[]`.
3. Map `ChatSendInput` to the Cloud controller. Convert portable attachments
   and browser `File` selections to Cloud inline/VFS attachments there.
4. Keep retry/fork lookup, approval decisions, steering, persistence,
   permissions, and session lifecycle in Cloud. Expose only their buttons and
   handlers through generic actions and callbacks.
5. Replace all built-in app imports in one change, then remove the old Cloud
   presentation exports only after the last caller is gone.
6. Update the official AI documentation, especially
   `docs-site/docs/en/ai/chat-interface.md` and the generated Cloud developer
   references, after the adapter is final. Document the generic UI contract
   separately from Cloud's protocol and controller contract.

Before that cutover, prove the package in the Fibel showcase with SSR,
hydration, keyboard commands, attachments, send failure restoration,
history loading, scroll follow, light/dark themes, and a narrow viewport.
