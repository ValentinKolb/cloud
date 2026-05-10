# Final Post-Cleanup Review

**Commits reviewed:** pre-review-cleanup..HEAD (20 commits)
**LOC delta:** +3067 / -1260

## Verdict
The cleanup closed most of the security/correctness Criticals: permissions are materially better, record writes are transactional, slug/liveness invariants are enforced, sort cursors no longer encode raw JSONB, and config validation moved into the service layer. It did not fully close the saved-view/query-state class, and it did not close the field-rendering or saved-view-dependent cleanup Criticals. I would not call this final-beta-ready yet, but the remaining blockers are now narrower and easier to reason about than the original review set.

## Critical findings status (from 00-summary.md)
- **#1 Audit log cross-table read leak — closed.** The route still gates table read, and the service query now scopes by both table and record: `api/records.ts:245`, `api/records.ts:249`, `service/audit.ts:95`.
- **#2 Personal view -> shared without admin — closed.** Publishing/unpublishing goes through base-admin: `api/views.ts:153`, `api/views.ts:158`.
- **#3 Personal dashboard -> shared without admin — closed.** Dashboard writes now require base-admin regardless of ownership/shared state: `api/dashboards.ts:153`, `api/dashboards.ts:158`.
- **#4 Saved-view URLs render unfiltered rows — partial.** SSR list mode now applies `resolveEffectiveQuery`: `frontend/[baseId]/page.tsx:328`, `frontend/[baseId]/page.tsx:363`. But the island is initialized with parsed URL query, not the effective saved-view query: `frontend/[baseId]/page.tsx:887`, `records-view/RecordsView.island.tsx:96`, `records-view/RecordsView.island.tsx:124`.
- **#5 Relation config can cross base boundaries — closed for app writes.** Create/update validate target table base scope before saving relation config: `service/fields.ts:153`, `service/fields.ts:168`.
- **#6 Dashboard editor remounts row on keystroke — closed.** Row and cell loops use `<Index>` instead of reference-keyed `<For>`: `DashboardEditPage.island.tsx:354`, `DashboardEditPage.island.tsx:365`, `DashboardEditPage.island.tsx:503`, `DashboardEditPage.island.tsx:604`.
- **#7 Field input rendering forks — not addressed.** `FieldInput` still renders currency as plain `NumberInput`, while `CreateRecordDialog` has its own currency/multi-select branches: `form-fields.tsx:129`, `CreateRecordDialog.tsx:140`, `CreateRecordDialog.tsx:252`.
- **#8 Sort cursor doesn't round-trip SQL value — closed.** The SELECT adds `__sort_<i>` aliases and encodes the cursor from those projected values: `service/sort-compiler.ts:254`, `service/sort-compiler.ts:263`, `service/records.ts:246`.
- **#9 Relation count aggregate reads obsolete JSONB — closed by rejection, not support.** Relation/computed aggregates now compile-error instead of silently reading `records.data`; relation grouping still uses `record_links`: `service/aggregate-compiler.ts:57`, `service/aggregate-compiler.ts:131`, `service/group-compiler.ts:179`.
- **#10 Field-dependents reads dropped `views.config` — closed.** It now selects `views.query`: `service/field-dependents.ts:85`, `service/field-dependents.ts:88`.
- **#11 Saved view dependents detected but never cleaned — not addressed.** Views are detected as non-blocking dependents, but `field.softDelete` only strips form config, not view query refs: `service/field-dependents.ts:96`, `service/fields.ts:499`.
- **#12 Dependent formulas lose upstream errors — closed, with semantic caveat below.** The evaluator propagates formula errors, and formula enrichment stores raw scratch values until final render: `formula/evaluator.ts:152`, `service/relations.ts:278`, `service/relations.ts:289`.
- **#13 Cycle detection misses interior nodes — closed.** DFS now marks every stack member from the back-edge onward, then renders `#CYCLE`: `service/relations.ts:220`, `service/relations.ts:226`, `service/relations.ts:279`.
- **#14 Permission resolver doesn't honor `none` — closed.** Principal-tier resolution returns `none` when any grant in the selected tier denies: `service/permission-resolver.ts:55`, `service/permission-resolver.ts:59`, `service/permission-resolver.ts:84`.
- **#15 Deleted parents don't hide children — closed for direct/list reads.** Table/field/record reads join the live parent chain: `service/tables.ts:80`, `service/fields.ts:104`, `service/records.ts:245`, `service/records.ts:417`.
- **#16 Record + relation writes not atomic — closed.** Create/update wrap record mutation, link writes, and audit in one transaction: `service/records.ts:488`, `service/records.ts:507`, `service/records.ts:588`, `service/records.ts:611`.
- **#17 Invalid configs persisted — closed for create/update.** Config schemas now reject impossible invariants and field create/update runs schema + DB-context validation before saving: `field-types/decimal.ts:5`, `field-types/select.ts:14`, `service/fields.ts:115`, `service/fields.ts:314`.

## New defects introduced (high-skepticism review)
### Formula scratch overlay
It preserves non-error semantics for scalar formula outputs, but not for formulas that return non-scalar cell values. Example: formula A = `#price` where `price` is a currency object. Old behavior wrote A's rendered JSON string before formula B evaluated; new behavior keeps the raw object in scratch (`service/relations.ts:278`, `service/relations.ts:284`), and `toNumber` treats currency objects as amounts (`formula/evaluator.ts:43`). So B = `#A * 2` now computes instead of returning null. That may be a better product behavior, but it is not a pure error-propagation-only change.

### View-merge in SSR page
Yes, stale view query can still render. `resolveEffectiveQuery` says URL filter/sort/group/agg override the saved view (`records-view/effective-query.ts:49`), but sidebar view links copy the view's current query into the URL (`frontend/[baseId]/page.tsx:773`). After editing a view, an old URL can keep overriding the updated saved query with stale serialized params.

There is also a stronger bug: SSR list rows use the effective query, but the client island receives `initialState.query` with `filter: parsedFilter` and `sort: parsedSort`, not the effective saved-view filter/sort (`frontend/[baseId]/page.tsx:887`). The first client query source is then built from that state (`RecordsView.island.tsx:96`, `RecordsView.island.tsx:124`), so clean saved-view URLs can refetch/paginate with unfiltered rows. Footer aggregates and grouped SSR also drift: aggregate filter uses `parsedFilter` (`page.tsx:425`), and grouped filter uses `activeView?.query.filter ?? parsedFilter`, ignoring URL override (`page.tsx:507`).

### Sort cursor SELECT extras
No conflict found. `__sort_<i>` is distinct from `r.*` columns and the computed projection aliases (`lkp_<uuid>`, `rlp_<uuid>`), and cursor encoding reads exactly those aliases: `service/records.ts:246`, `service/computed-projections.ts:39`, `service/sort-compiler.ts:254`.

### validateLinkOrComputedConfig
Not bypassable through normal field create/update API: relation targets, display fields, lookup relation fields, and target fields are checked before save (`service/fields.ts:145`, `service/fields.ts:225`, `service/fields.ts:321`). Remaining gaps: there is no DB constraint over JSONB configs, so legacy/corrupt configs survive until touched; and validation is not in the same transaction as concurrent target deletion. Also, lookup/rollup projection currently cannot resolve target-field storage for cross-table targets because `records.list` passes only source-table fields (`service/records.ts:203`, `service/records.ts:233`) while `buildComputedProjections` looks up `cfg.targetFieldId` in that same map (`service/computed-projections.ts:128`). Non-count rollups across relations will silently skip projection.

### Other
- **Saved-view field cleanup is still missing.** This is not just deferred polish: delete-field can leave saved views carrying stale filter/sort/group refs because only forms are cleaned (`service/fields.ts:499`).
- **Storage descriptor is incomplete adoption.** `field-storage.ts` is the right direction, but `group-compiler.ts` still re-spells currency/numeric projection rules (`group-compiler.ts:214`, `group-compiler.ts:270`), so the centralization is not finished.

## Deferred work — recommended priority
1. **Wave 5.3: one field-rendering registry.** Highest user impact: create/edit/forms/default-value surfaces still disagree on currency and multi-select.
2. **Wave 6.2: editor draft helper.** Save/dirty/discard behavior is still user-visible, especially around view/dashboard editing; the permission wrapper part is lower impact.
3. **Remaining Wave 6.3: label-cache collapse + displayFieldId decision.** Relation labels are visible everywhere and still carry product ambiguity; resolve this before more relation UI is built.
4. **Wave 5.1: split scalar/computed/link kinds.** Worth doing only insofar as it prevents bugs like the cross-table rollup projection miss; not worth a purity refactor by itself.
5. **Wave 5.4: text-preset collapse.** Lowest immediate user impact unless you are already touching the field registry; fold it into that work if the product decision is settled.

## LOC delta sanity
+1800 net is understandable for security/correctness waves, but it misses the parent task's "net negative" expectation. The bulk is `field-storage.ts` (+349), `migrate.ts` (+177), `records.ts` (+88 net), `fields.ts` (+119 net), `relations.ts` (+92 net), `sort-compiler.ts` (+71 net), and permission tests/resolver. The new descriptor module is justified, but only if it becomes the actual compiler source of truth; right now some projection logic remains duplicated, which is the main over-engineering smell. The rest is mostly invariant enforcement and tests, not gratuitous abstraction.

## Final TLDR
Most landed waves closed their intended security and data-integrity Criticals. The code is safer than pre-cleanup, but not final: fix saved-view effective query state end-to-end, clean saved-view field refs on delete, and repair cross-table rollup projections before calling the Critical list closed. After that, tackle the field-rendering registry next because it is the remaining user-facing Critical.
