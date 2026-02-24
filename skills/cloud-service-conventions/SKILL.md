---
name: cloud-service-conventions
description: Use when implementing or refactoring services to keep the stateless functional service style, config-object inputs, pagination/get semantics, and shared result patterns.
---
# Cloud Service Conventions

Use this skill for service-layer quality and consistency.

## Core Service Rules

1. Services are stateless objects.
2. Public service methods take config objects.
3. `list` returns paginated results and supports optional filter.
4. `get` returns one item or `null`.
5. Expected failures use `Result` (`fail(err.*)`), not throws.
6. Domain logic belongs in services, not API handlers.
7. Filter-heavy `list` methods keep list/count SQL parity.
8. Server-side app logging uses shared logger, not direct `console.*`.

## Method Shape Guidance

- Prefer grouping by domain:
  - `service.book.*`
  - `service.note.*`
  - `service.item.*`
- Keep helper functions private unless cross-module reuse is real.
- Add concise semantic docstrings for non-obvious methods.
- Prefer one logger per module via:
  `import { logger } from "@valentinkolb/cloud-lib/server/services/logging"`.

## Examples to Reuse as Pattern Sources

- Files service facade:
  `cloud/packages/apps/src/files/service/index.ts`
- Notebooks service facade:
  `cloud/packages/apps/src/notebooks/service/index.ts`
- Spaces service facade:
  `cloud/packages/apps/src/spaces/service/index.ts`

## Flexibility Rule

Do not over-fit all domains to identical nesting depth.
Use the smallest shape that keeps method discovery and ownership clear.

## References

- Service shape examples and anti-patterns: `references/service-shape.md`

## Reference Routing

- Read `references/service-shape.md` for method semantics, query parity rules, and logging conventions.
