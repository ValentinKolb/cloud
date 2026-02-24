---
name: cloud-testing-quality
description: Use when validating cloud changes, defining test scope, or adding quality gates so regressions are caught with minimal but high-signal checks.
---
# Cloud Testing and Quality

Use this skill to validate changes with minimal, high-signal checks.

## Required Gates

- `check:skills`
- `check:boundaries`
- `check:cycles`
- `check:service-api-contracts`
- workspace `typecheck`
- workspace `build` for release-level confidence

## Validation Strategy

1. Run static gates first.
2. Run type/build.
3. Run focused manual smoke paths only for touched flows.
4. Report unvalidated areas explicitly.

## Smoke Testing Heuristics

- If API changed: validate success + known error paths.
- If SSR page changed: validate initial render + URL/deep link behavior.
- If island changed: validate interaction + keyboard/focus behavior.
- If ACL changed: validate role gate + resource gate + guard edges.
- If filter/query state changed: validate parse/serialize, pagination parity, and back/forward state restore.

## References

- High-signal test matrix: `references/test-matrix.md`

## Reference Routing

- Read `references/test-matrix.md` to select minimal high-signal checks per touched area.
