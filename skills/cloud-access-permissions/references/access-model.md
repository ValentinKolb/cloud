# Access Model

## Identity Sources

- FreeIPA-backed user/group entities for enterprise identities.
- Local guest accounts for email-token flows.

## Access Layers

1. Role gate (`auth.requireRole`).
2. Resource ACL evaluation (`read/write/admin`).
3. Guard constraints (last-admin, last-entry, system-resource rules).

## Shared ACL Core

- `auth.access` stores principal + permission.
- App-specific join table connects resource to access entries.
- Effective permission resolves from user + groups + public entries.

## Permission Levels

- `none`
- `read`
- `write`
- `admin`

## Guard Checklist for Mutations

- target resource exists
- current user has required level
- target access relation belongs to resource
- last admin not removed/downgraded (if policy requires)
- last ACL entry not removed (if policy requires)
- system resource ACL mutation blocked

## Route Permission Matrix Template

| Concern | Typical minimum level |
| --- | --- |
| list/get | `read` |
| create/update | `write` |
| delete/access-admin | `admin` |

Use this as a default and deviate only with explicit domain reason.

## Guard Data Contract (for ACL edits)

When implementing last-admin/last-entry rules, fetch guard data from service first:

- `total` access entries
- `currentPermission` of target entry
- `otherAdmins` count excluding target entry

## Pattern Sources

- Access core service:
  `cloud/packages/server/src/core/services/access/index.ts`
- App implementations:
  notebooks/spaces/contacts `service/access.ts`
