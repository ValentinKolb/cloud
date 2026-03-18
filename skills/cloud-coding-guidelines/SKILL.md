---
name: cloud-coding-guidelines
description: Use when writing or refactoring code across cloud packages to enforce shared coding rules (YAGNI, KISS, DRY), readability-first functional style, strict package boundaries, and consistency with service/API/frontend conventions.
---
# Cloud Coding Guidelines

Use this skill as the cross-cutting rule layer for code quality and consistency.

## Core Priorities

Apply these in order:

1. YAGNI: ship only what is needed now.
2. KISS: prefer obvious, boring code over clever abstractions.
3. DRY: deduplicate real repetition, but avoid premature abstractions.
4. Consistency: follow existing project conventions over personal style.

## Cloud-Wide Rules

1. Keep business logic in services; API/page layers stay orchestration-focused.
2. Prefer stateless, functional method style with config-object inputs.
3. Use shared components/helpers before creating app-local variants.
4. Favor explicit data flow; avoid hidden global state.
5. Expected failures use `Result` patterns, not exceptions.
6. Keep code readable first; optimize only with concrete need.
7. Keep comments semantic: purpose, assumptions, side effects.
8. Use workspace-relative paths in docs/examples: start with `cloud/`.

## Package Boundary Rules

1. Respect package responsibilities:
   - `@valentinkolb/cloud/core`: runtime orchestration
   - `@valentinkolb/cloud/lib/server`: server services + middleware
   - `@valentinkolb/cloud/lib/ui`, `cloud/lib/browser`, `cloud/lib/shared`, `cloud/lib/islands`: UI + browser utilities
   - `@valentinkolb/cloud/contracts`: shared schemas/types/contracts
   - `@valentinkolb/cloud/apps`: app implementations
2. Do not introduce deep cross-package internals imports.
3. Keep public APIs explicit through package exports.

## Quick Routing To Detail Skills

- Service shape and method semantics:
  `../cloud-service-conventions/SKILL.md`
- API wrapper patterns and middleware order:
  `../cloud-api-patterns/SKILL.md`
- Access and ACL patterns:
  `../cloud-access-permissions/SKILL.md`
- Settings and config persistence:
  `../cloud-settings-config/SKILL.md`
- Frontend SSR/islands + a11y consistency:
  `../cloud-frontend-consistency/SKILL.md`
- Test and validation strategy:
  `../cloud-testing-quality/SKILL.md`

## Quality Gates Before Finishing

Run and pass:

1. `bun run check:biome`
2. `bun run typecheck`

Use these as mandatory gates, not optional polish.

## References

- Rule matrix and concise do/don't examples:
  `references/rule-matrix.md`

## Reference Routing

Read `references/rule-matrix.md` when you need concrete coding style decisions (types, async style, error handling, naming, and anti-pattern checks).
