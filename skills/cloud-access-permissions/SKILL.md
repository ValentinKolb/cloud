---
name: cloud-access-permissions
description: Use when changing auth, roles, access tables, book/notebook/space ACL behavior, or permission guards so access logic remains consistent across services and APIs.
---
# Cloud Access and Permissions

Use this skill for role gates, ACL joins, and permission guard logic.

## Identity Model

- IPA-backed users/groups remain the source of truth for enterprise identities.
- Local guest users exist as a separate auth mode.
- App resources map to shared `auth.access` entries via app-specific join tables.

## Access Layers

1. Role gate (`auth.requireRole(...)` on route level).
2. Resource ACL gate (`read/write/admin`).
3. Service-level resource integrity checks (ownership/scope/system guard).

## Guard Rules

- Keep permission resolution in service layer.
- Re-check required permission in API wrappers.
- Protect last-admin and last-entry semantics where needed.
- Reject ACL mutation for virtual/system resources.
- Validate relation scope before mutation (`entry belongs to resource`).
- Keep one explicit permission matrix per resource.

## Quick Lookup

- Access primitives:
  - import: `from "@valentinkolb/cloud/lib/server"` (exports `createAccess`, `getAccess`, `updateAccess`, `deleteAccess`, `getEffectivePermission`, `hasPermission`, `PERMISSION_LEVELS`)
  - source: `cloud/packages/lib/src/server/services/access.ts`
- Auth middleware:
  - import: `from "@valentinkolb/cloud/lib/server"` (exports `auth`, `type AuthContext`)
  - source: `cloud/packages/lib/src/server/middleware/auth.ts`
- Notebook ACL pattern:
  `cloud/packages/apps/src/notebooks/service/access.ts`
- Spaces ACL pattern:
  `cloud/packages/apps/src/spaces/service/access.ts`
- Contacts ACL pattern:
  `cloud/packages/apps/src/contacts/service/access.ts`

## References

- Access model and guard checklist: `references/access-model.md`

## Reference Routing

- Read `references/access-model.md` for ACL table shape, guard checklist, and permission matrix defaults.
