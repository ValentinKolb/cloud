# Cloud UI migration inventory

Cloud remains on `@valentinkolb/cloud/ui` until the generic package is
complete. There are no compatibility re-exports and no incremental application
migration.

[`migration-inventory.json`](./migration-inventory.json) classifies every
module contributing public exports to the current Cloud UI barrel:

- `generic`: belongs in `@k2b/ui`, grouped like the component catalog;
- `cloudSpecific`: keeps a real Cloud runtime or domain contract;
- `deprecated`: must not be promoted into the new package.

Every named export inherits the classification of its source module. Run
`bun run check:migration` from `packages/ui` after changing either public
surface. The check follows barrel exports and fails for missing, stale, or
duplicate classifications.

The `implemented` status means the target package already exposes the intended
generic capability. It does not promise source or prop compatibility with the
old Cloud component; the final Cloud migration updates consumers in one hard
cut.
