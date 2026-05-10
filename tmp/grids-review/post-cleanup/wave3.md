# Wave 3 (Frontend Correctness) — Post-Cleanup Review

**Commits reviewed:** 370d04f, a67b0de, cc05c94
**Files reviewed:** `packages/grids/src/frontend/[baseId]/page.tsx`, `packages/grids/src/frontend/_components/records-view/query-url.ts`, `packages/grids/src/frontend/_components/records-view/effective-query.ts`, `packages/grids/src/frontend/_components/DashboardEditPage.island.tsx`

## Verdict
Wave 3 closes the direct view visibility leak and fixes the dashboard editor's row/cell remount path. The URL parser is now the SSR parser, and the saved-view merge is correct for the first flat `record.list` request. The saved-view critical is not fully closed yet: the merged query is not the state hydrated into `RecordsView`, and grouped/aggregate SSR paths still recompute filters outside the new helper.

## Closed findings
- **URL parser is now SSR source of truth — closed.** The SSR page parses search params through `parseRecordsState(new URL(c.req.url).searchParams)` instead of hand-parsing filter/sort/group/search (`packages/grids/src/frontend/[baseId]/page.tsx:76`). The same parser remains the client popstate parser in `RecordsView`, so `q`, `qFields`, `cursor`, `record`, `view`, `trash`, filter, sort, group, and aggregations now share one parser.
- **URL-owned query shape no longer pretends to include view-only fields — closed enough.** `RecordsUrlQuery` narrows URL state to filter/sort/groupBy/aggregations/includeDeleted (`packages/grids/src/frontend/_components/records-view/query-url.ts:34`), and `buildRecordsUrl` only serializes that subset plus sibling cursor/record/view/search fields (`packages/grids/src/frontend/_components/records-view/query-url.ts:141`). The new round-trip tests cover representative meaningful states (`packages/grids/src/frontend/_components/records-view/query-url.test.ts:125`).
- **Direct view lookup no longer bypasses visibility at render time — closed.** `getByIdOrSlug` now produces only a `candidateView`; the page adopts it as `activeView` only when `listForTable` returns the same id for the current user/groups (`packages/grids/src/frontend/[baseId]/page.tsx:315`, `packages/grids/src/frontend/[baseId]/page.tsx:320`). Hidden views therefore do not supply names, columns, limits, filters, or active sidebar state.
- **Dashboard editor row/cell focus loss — closed.** The top-level dashboard rows use `<Index>` instead of reference-keyed `<For>` (`packages/grids/src/frontend/_components/DashboardEditPage.island.tsx:365`), and editable stats/view cells also use `<Index>` (`packages/grids/src/frontend/_components/DashboardEditPage.island.tsx:503`, `packages/grids/src/frontend/_components/DashboardEditPage.island.tsx:604`). Because `updateRow` and `updateCell` replace objects on every keystroke, this is the right Solid primitive to keep the mounted editor and focused input stable.

## New findings
### Critical
- **Saved-view query is not hydrated into the records island** — `packages/grids/src/frontend/[baseId]/page.tsx:887` — the flat SSR list request uses `effective.filter` and `effective.sort` (`packages/grids/src/frontend/[baseId]/page.tsx:344`, `packages/grids/src/frontend/[baseId]/page.tsx:369`), but `RecordsView.initialState.query` gets `parsedFilter` and `parsedSort` instead (`packages/grids/src/frontend/[baseId]/page.tsx:889`, `packages/grids/src/frontend/[baseId]/page.tsx:890`). A clean saved-view URL can first-paint correctly, then client refetch/search/pagination/export from a query missing the saved view's filter/sort. Pass the same hoisted `effective` query into `initialState` that SSR used for `record.list`.

### Important
- **Grouped and footer aggregate paths still bypass the effective filter** — `packages/grids/src/frontend/[baseId]/page.tsx:425` — footer aggregates use `parsedFilter`, so clean saved-view filters are ignored in footer numbers. Grouped mode uses `activeView?.query.filter ?? parsedFilter` (`packages/grids/src/frontend/[baseId]/page.tsx:508`), so URL filter overrides are ignored whenever the active view has a saved filter. Hoist `effective`/`effectiveFilter` and feed the same filter to list, aggregate, and group.
- **Saved-view `includeDeleted` is merged but not applied** — `packages/grids/src/frontend/[baseId]/page.tsx:367` — `resolveEffectiveQuery` computes `includeDeleted` (`packages/grids/src/frontend/_components/records-view/effective-query.ts:57`), but SSR passes `trashMode` to `record.list` and to the island state (`packages/grids/src/frontend/[baseId]/page.tsx:893`). If `includeDeleted` remains part of saved `ViewQuery`, use `effective.includeDeleted`; otherwise delete it from saved-view merge semantics.

### Minor
- **Round-trip claim still excludes empty arrays/false flags** — `packages/grids/src/frontend/_components/records-view/query-url.ts:128` — `buildRecordsUrl` omits empty arrays and `includeDeleted: false`, while `parseRecordsState` returns `undefined` for those (`packages/grids/src/frontend/_components/records-view/query-url.ts:92`, `packages/grids/src/frontend/_components/records-view/query-url.ts:155`). Semantically fine, but not literal `parse(build(s)) === s` for every type-valid `RecordsState`; either normalize the type/comment or add a normalizer in tests.

## KISS / overengineering check
The right simplification is to make one `effective` object live long enough to serve every consumer: SSR list, SSR aggregate, SSR group, `RecordsView.initialState`, and export/query refetch. The current split already produced one duplicated merge and one wrong duplicate merge.

`EffectiveQuery.source` is unused in this slice (`packages/grids/src/frontend/_components/records-view/effective-query.ts:26`). Delete it until the UI actually renders the "view customized" badge, or wire it through now. Keeping unused state classification makes the merge helper look more complete than it is.

The dashboard editor change is KISS enough. `<Index>` is a small local change that directly matches Solid's object-replacement behavior here; the long explanatory comments can be trimmed after the fix settles.

## Open follow-ups noticed during review
- Decide whether URL empty arrays are meaningful overrides on saved views. If "clear sort/group/agg for this URL" should be possible, the URL format needs an explicit empty marker; if not, document that empty means absent.
- Decide whether saved views should persist `search` and `includeDeleted`. `ViewQuerySchema` allows both, but this page mostly treats search as URL-only and includeDeleted as `trashMode`.

## Verification
- Ran `bun test packages/grids/src/frontend/_components/records-view/query-url.test.ts`: 19 pass.
