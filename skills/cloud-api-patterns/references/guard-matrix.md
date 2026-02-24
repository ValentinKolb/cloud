# API Guard Matrix Pattern

## Goal

Make permission intent obvious and consistent across handlers.

## Resource Route Matrix Template

| Route Group | Required Level | Notes |
| --- | --- | --- |
| List/Get | `read` | Includes detail endpoints |
| Create/Update | `write` | Includes non-destructive mutations |
| Delete/Access Admin | `admin` | Includes ACL changes and destructive ops |

## Recommended Flow

1. Resolve resource existence once.
2. Check required level with a single helper.
3. Return standardized not-found/forbidden via `respond(...)`.
4. Keep mutation handler focused on validated payload + service call.

## Handler Helper Shape

```ts
const requireResourceAccess = async (
  c: Context<AuthContext>,
  resourceId: string,
  requiredLevel: PermissionLevel = "read"
) => {
  // resolve + permission check + standardized error response
};
```

## Guard Edge Checklist

- Resource exists.
- Relation belongs to resource (`itemId` in `spaceId`, etc.).
- Last-admin and last-entry guards before ACL mutation.
- System/virtual resources blocked when not mutable.

## Pattern Sources

- Guard helper + ACL routes:
  `cloud/packages/apps/src/spaces/api.ts`
- ACL mutation guard data source:
  `cloud/packages/apps/src/spaces/service/access.ts`
