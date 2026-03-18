# Module Review: Accounts API — Users

## Scope

`packages/apps/src/accounts/api/users.ts` (~493 lines)

Admin user management API routes.

---

## Findings

### AU-01 | high | No self-action prevention on destructive operations

**Impact:** An admin can delete/demote themselves, potentially locking themselves out.

No route checks `id === actor.id` before executing destructive operations like `DELETE /:id`, `POST /:id/switch-provider`, or `POST /:id/set-profile`. An admin could accidentally destroy their own account.

**Files:** `api/users.ts` (all mutation routes)

---

### AU-02 | medium | `DELETE /:id` destroy mode does not validate IPA session for IPA users

**Impact:** Destroy of an IPA user may fail with an unclear error if IPA session is null.

In lines 481-489, `getIpaSession` is called but never checked. The "demote" mode explicitly checks for IPA session (line 466-468), but "destroy" mode does not. If the target is an IPA user and `ipaSession` is null, the service layer receives `null` and may fail with a confusing error.

**Files:** `api/users.ts:481-489` vs `api/users.ts:466-468`

---

### AU-03 | medium | `PATCH /:id` fetches IPA session unconditionally

**Impact:** Unnecessary IPA session fetch when editing local users; potential confusing error.

Line 174-175 calls `getIpaSession` regardless of the target user's provider. For local users, `ipaSession` will be null. This is passed to `accountsService.user.update` which must handle `null` gracefully. The `POST /` (create) route correctly fetches IPA session only when `data.provider === "ipa"`.

**Files:** `api/users.ts:174-175` vs `api/users.ts:139`

---

### AU-04 | low | `POST /:id/set-expiry` accepts free-form string, not validated as date

**Impact:** Invalid date strings could reach the service layer.

The schema only validates `z.string().nullable()` for the expiry date. No `.datetime()` or `.regex()` refinement ensures the string is a valid ISO date. The service layer normalizes it via `normalizeManualAccountExpiry` which calls `new Date()`, but an invalid string would produce `Invalid Date`.

**Files:** `api/users.ts:368` (schema inline)

---

### AU-05 | low | `POST /:id/reset-password` double-fetches user

**Impact:** Minor inefficiency.

Lines 205-206 call `requireIpaSession` (which implicitly validates the actor), then `accountsService.user.get` to validate the target. The target user data is only used for null-checking existence. A lighter check would suffice.

**Files:** `api/users.ts:205-206`

---

## Open Questions / Assumptions

1. Should there be an explicit self-action guard (`id !== actor.id`) for destructive operations?
2. Should the destroy mode check `ipaSession` explicitly for IPA targets?

## Conclusion

The admin user API is correctly protected by `auth.requireRole("admin")`. The main concern is the missing self-action prevention (AU-01), which could lead to an admin locking themselves out. The IPA session handling is inconsistent across routes (AU-02/03) and should be unified. All routes correctly use structured response handling via `respond()`.
