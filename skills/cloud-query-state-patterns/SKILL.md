---
name: cloud-query-state-patterns
description: Use when implementing filter-heavy SSR pages, URL-driven state, hybrid detail panels, or SQL list/count queries so query contracts stay consistent and reliable.
---
# Cloud Query and State Patterns

Use this skill when page state depends on URL params and backend list/search queries.

## Core Rules

1. URL is canonical for user-visible state (search, filters, sort, page, selected detail).
2. Keep one explicit state contract per screen (keys, defaults, parse/serialize).
3. Keep list query and count query parity.
4. Keep query building composable and parameterized.
5. Keep SSR render valid without client JavaScript.

## Quick Lookup (Do Not Guess)

- URL/filter helper pattern source:
  `cloud/packages/apps/src/spaces/frontend/[id]/_components/filter/types.ts`
- Hybrid detail panel helper source:
  `cloud/packages/client/src/lib/browser/detail-panel.ts`
- Complex filter SQL pattern source:
  `cloud/packages/apps/src/spaces/service/items.ts`

## Build Sequence

1. Define state contract (query keys + defaults + coercion).
2. Implement parse + serialize helpers and use them everywhere.
3. Keep URLs clean (omit default values).
4. Implement list query and count query from shared conditions.
5. Add SSR + back/forward + deep-link smoke checks.

## References

- URL and query-state contracts: `references/url-state-contract.md`
- SQL list/count parity rules: `references/sql-list-count-parity.md`
- Hybrid detail panel behavior: `references/hybrid-detail-pattern.md`

## Reference Routing

- Read `references/url-state-contract.md` first when defining query keys/defaults.
- Read `references/sql-list-count-parity.md` when implementing service-side list/search queries.
- Read `references/hybrid-detail-pattern.md` when preserving scroll and back/forward in detail panels.
