# Module Review: Accounts API — Groups

## Scope

`packages/apps/src/accounts/api/groups.ts` (~459 lines)

Group management API routes with mixed access levels (user + admin).

---

## Findings

### AG-01 | medium | API layer does not enforce explicit authorization for IPA group mutations, relying on downstream FreeIPA ACLs

**Impact:** The app API does not enforce admin or manager checks for IPA group membership mutations. It relies on FreeIPA's own permission system to reject unauthorized operations.

Line 38: if `group.provider !== "local"`, `requireLocalGroupManageAccess` returns `null` (no app-level check). However, `requireGroupMutationContext` (lines 65-77) does require a valid IPA session for IPA groups -- returning an error if `ipaSession` is null. So the actual attack surface is "any user with a valid IPA session", not "any user". FreeIPA enforces its own ACLs on the actual RPC call, which would reject unauthorized mutations.

This is a defense-in-depth gap, not an automatic exploit. The fix should add an explicit admin-or-IPA-manage check at the API layer for IPA groups, without accidentally breaking valid local group manager flows.

**Files:** `api/groups.ts:30-47, 50-78`

---

### AG-02 | medium | Double group fetch in `requireGroupMutationContext`

**Impact:** Performance and potential TOCTOU issue.

`requireGroupMutationContext` (line 50) fetches the group, then calls `requireLocalGroupManageAccess` (line 34) which fetches the same group again via `accountsService.group.get`. The group state could change between the two fetches.

**Files:** `api/groups.ts:51-58, 34`

---

### AG-03 | medium | Admin group mutation routes don't validate IPA session for IPA groups

**Impact:** Silent null `ipaSession` passed to service for IPA group operations.

`DELETE /:id` (line 384-394), `PATCH /:id` (line 396-426), and `POST /:id/make-posix` (line 428-456) all call `getIpaSession` but don't check the result before passing it to the service. For local groups this is fine, but for IPA groups, a null `ipaSession` may cause a failure inside the service layer with an unclear error.

**Files:** `api/groups.ts:384-456`

---

### AG-04 | low | Search endpoint uses `/:id/search` with sentinel `_` for global search

**Impact:** URL design smell.

Line 123: when `groupId === "_"`, it passes `undefined` to search globally. A separate route or query parameter would be cleaner than a sentinel value.

**Files:** `api/groups.ts:123`

---

## Open Questions / Assumptions

1. Does the FreeIPA backend enforce its own permissions for member/manager mutations, making AG-01 safe in practice?
2. Should `requireGroupMutationContext` cache the group fetch to avoid the double lookup?

## Conclusion

The groups API has a defense-in-depth authorization gap (AG-01) where IPA group mutations are not explicitly gated at the app layer beyond requiring a valid IPA session. FreeIPA enforces its own ACLs downstream, but the API layer should be explicit. The double-fetch pattern (AG-02) and missing IPA session validation (AG-03) are common themes across the API layer. Read-only operations are correctly scoped to `"user"` role, and admin mutations correctly require `"admin"`.
