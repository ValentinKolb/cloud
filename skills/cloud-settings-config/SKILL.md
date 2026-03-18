---
name: cloud-settings-config
description: Use when adding or changing runtime settings, defaults, admin settings APIs/UI, or config resolution behavior in the cloud stack.
---
# Cloud Settings and Config

Use this skill for runtime-configurable behavior.

## Principles

1. Prefer runtime settings over hardcoded values.
2. Keep keys namespaced (`group.key`).
3. Keep deterministic resolution order.
4. Document new keys in high-level docs + skill references.

## Resolution Order

1. DB override
2. env fallback (when supported)
3. code default

## Quick Lookup (Do Not Guess)

- Settings storage/resolution:
  `cloud/packages/core/src/services/settings/index.ts`
- Settings registry/defaults:
  `cloud/packages/core/src/services/settings/defaults.ts`
- Settings service wrapper app:
  `cloud/packages/apps/src/settings/service/index.ts`

## Standard Change Flow

1. Add key default metadata.
2. Use setting in runtime/service code.
3. Add/update admin setting handling when needed.
4. Validate with restart + settings UI.

## References

- Settings key conventions and examples: `references/settings-patterns.md`

## Reference Routing

- Read `references/settings-patterns.md` for key naming, precedence, and safe cookie/runtime patterns.
