---
name: cloud-troubleshooting
description: Use when diagnosing runtime, build, SSR, API, auth, migration, or workspace issues in the cloud monorepo and you need a fast structured debug workflow.
---
# Cloud Troubleshooting

Use this skill for incident-style debugging and fast root-cause isolation.

## Debug Sequence

1. Reproduce with exact URL/command.
2. Identify failing layer (client/app/server/core/db).
3. Verify import boundaries and package surfaces.
4. Verify env/settings assumptions.
5. Verify SQL/ACL/runtime invariants.
6. Add regression guard after fix.

## Common Failure Classes

- Browser build imports server/Bun code.
- API/service drift after refactor.
- SQL query shape errors (UNION DISTINCT/ORDER BY/pagination mismatch).
- SSR asset path or monorepo-root mismatch.
- ACL mismatch between page/API/service checks.

## Practical Rule

Favor small, reversible fixes first; expand scope only if root cause requires it.

## References

- Failure playbooks and checks: `references/common-failures.md`

## Reference Routing

- Read `references/common-failures.md` for symptom-to-check mappings before broad code changes.
