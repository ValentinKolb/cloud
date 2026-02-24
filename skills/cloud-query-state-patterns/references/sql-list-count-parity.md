# SQL List/Count Parity

## Goal

Avoid pagination bugs where `total` and displayed items diverge.

## Rules

1. Build one shared `conditions` SQL fragment and reuse it for both queries.
2. Keep joins needed for filtering aligned between list and count.
3. Keep search/filter semantics identical between list and count.
4. Keep access predicates identical between list and count.
5. Keep count query free of limit/offset and order.

## Deterministic Recipe

1. Build base condition (scope/access).
2. Layer each optional filter onto the same condition fragment.
3. Run count query with that exact condition.
4. Run list query with same condition + order + pagination.

## Common Pitfalls

- `DISTINCT ... ORDER BY` mismatch.
- `UNION` branch type mismatch (cast explicitly).
- Missing join in count query causing inflated totals.
- Search filter applied to list but not count.

## Pattern Source

- Filter-heavy, parameterized query builder:
  `cloud/packages/apps/src/spaces/service/items.ts`
