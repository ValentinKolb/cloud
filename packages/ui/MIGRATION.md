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
  `MultiSelectInput`, `SelectChip`, `TagsInput`;
- layout: `AppOverview`, `DataPanel`, `PanelDialog`, `PanelHeader`;
- surfaces: `NotFoundState`, `Placeholder`;
- feedback: `dialog-core`, `prompts`, `toast`, `Tooltip`.

Everything else remains `planned` until it satisfies that same bar. The
working tree may contain experiments for planned components; those do not
change their inventory status and must not be released as complete.

Cloud-owned controllers and domain contracts remain outside the package. This
includes permission and principal editors, resource API keys, workflow
authoring, stored AI protocols/controllers, and profile-specific avatar writes.
Generic image inputs and generic AI presentation still belong in `@k2b/ui`,
but only after their full presentation contracts are migrated.

Run `bun run check:migration` from `packages/ui` after changing either source
surface. The check follows barrel exports and fails for missing, stale, or
duplicate classifications.

## Acceptance sequence

1. Complete and verify `@k2b/ui` through its standalone `@k2b/ssr` fixture.
2. Migrate the Fibel component showcase as the first external consumer.
3. Fix package boundaries or APIs found by that migration in the package.
4. Migrate Cloud and all built-in apps in one hard cut.
