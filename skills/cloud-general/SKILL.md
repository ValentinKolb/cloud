---
name: cloud-general
description: Use when working in the cloud monorepo and you need the default operating rules, decision priorities, or pointers to the right specialized cloud skill.
---
# Cloud General

Use this as the default cloud skill before applying specialized skills.

## Priorities

1. Keep the codebase consistent.
2. Keep code readable and functional.
3. Apply YAGNI, KISS, DRY.
4. Stay aligned with package/public-contract boundaries.

## Working Style

- Prefer concrete code changes over abstract guidance.
- Use existing patterns before creating new abstractions.
- Keep solutions small and composable.
- Prefer config objects over long positional parameter lists.

## Flexibility Rule

These are guardrails, not a style prison.

- If a stronger local pattern exists in touched code, follow it.
- If a guideline conflicts with correctness or accessibility, prioritize correctness/accessibility.
- When deviating, document why in code comments or PR notes.

## Skill Routing

Choose only the minimum set needed:

- Runtime/package structure: `../cloud-architecture-runtime/SKILL.md`
- New/refactored app facades: `../cloud-app-builder/SKILL.md`
- URL state + filter/query contracts: `../cloud-query-state-patterns/SKILL.md`
- Service work: `../cloud-service-conventions/SKILL.md`
- API wrappers: `../cloud-api-patterns/SKILL.md`
- ACL/auth/roles: `../cloud-access-permissions/SKILL.md`
- Runtime settings: `../cloud-settings-config/SKILL.md`
- Frontend/UI behavior: `../cloud-frontend-consistency/SKILL.md`
- Validation gates: `../cloud-testing-quality/SKILL.md`
- Debugging/incidents: `../cloud-troubleshooting/SKILL.md`

## References

- Priorities and anti-patterns: `references/decision-priorities.md`

## Reference Routing

- Read `references/decision-priorities.md` when choosing between multiple valid implementations.
