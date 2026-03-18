# Module Review: Core Account Users

## Scope

`packages/core/src/services/accounts/users.ts` (749 lines)
`packages/core/src/services/accounts/model.ts` (33 lines)
`packages/core/src/services/accounts/authz.ts` (22 lines)
`packages/core/src/services/accounts/compat.ts` (57 lines)

The core user domain layer -- provider-agnostic facade that delegates to IPA or local provider modules.

---

## Findings

### CU-01 | high | `get()` is too expensive for existence checks

**Impact:** Performance degradation under load. Every mutation calls `get()`.

`get()` (line 201) runs a massive query with 4 correlated subqueries, 2 of which contain `WITH RECURSIVE` CTEs for group hierarchy resolution. It returns a full `SessionUser` with all groups, manager assignments, and roles.

This function is called by `create`, `update`, `setProfile`, `setExpiry`, `sendLoginLink`, `createLoginToken`, `resetPassword`, `switchProvider`, `remove`, and `demoteToGuest`. Most of these only need to verify the user exists and check their provider -- they do NOT need recursive group resolution.

A lightweight `getUserRow()` already exists (line 94) and would suffice for most validation paths.

**Files:** `users.ts:201-269` (called from ~12 mutation functions)

---

### CU-02 | medium | `switchProvider()` double-fetches the same user

**Impact:** Unnecessary DB round-trip.

Lines 660-667 call both `getUserRow()` AND `get()` for the same user. The `getUserRow` result is used for `currentProvider`/`currentProfile`/`currentExpiry`, and the `get` result is used for `user.mail`, `user.givenname`, etc. These could be unified into a single call.

**Files:** `users.ts:660-667`

---

### CU-03 | medium | `switchProvider()` to IPA may not properly reuse the existing user row

**Impact:** Potential data integrity issue.

When switching local -> IPA (lines 677-696), the code calls `providers.ipa.users.create()` to create the IPA account. But the existing local user row in `auth.users` is not explicitly updated or cleaned up. The code relies on the IPA create doing an UPSERT by email, but this is not explicit. If IPA create inserts a new row rather than updating the existing one, the user would have two rows (one local orphan, one new IPA).

**Files:** `users.ts:682-695`

---

### CU-04 | medium | `buildBaseUser()` vs `toBaseUser()` in groups.ts -- display name inconsistency

**Impact:** Same user may show different display names depending on which code path renders them.

`users.ts:buildBaseUser()` (line 128) and `groups.ts:toBaseUser()` (line 16) both map DB rows to `BaseUser` but have different displayName fallback logic. The `groups.ts` version falls back to `mail || uid` for all users, while `users.ts` only falls back to `mail` for guests. A non-guest user with no display name would show differently in the users list vs. the groups member list.

**Files:** `users.ts:128-151`, `groups.ts:16-40`

---

### CU-05 | low | `providerProfileFromRealm` silently defaults corrupt realm to local/guest

**Impact:** Corrupt data is silently treated as a valid state.

In `compat.ts:14`, the `default` case in the switch falls through to the `"guest"` case, returning `{ provider: "local", profile: "guest" }`. An unexpected realm value (e.g., from DB corruption) becomes a local guest without any warning or logging. This should at minimum log a warning.

**Files:** `compat.ts:14`

---

### CU-06 | low | `normalizeManualAccountExpiry()` time normalization inconsistency

**Impact:** Minor data inconsistency.

`normalizeManualAccountExpiry()` (line 57) sets expiry to 23:59:59.000 UTC. But `getDefaultAccountExpiry()` (line 79) only normalizes to end-of-day for IPA accounts -- local accounts use raw `addDays()` without normalization.

**Files:** `users.ts:57, 79`

---

### CU-07 | info | `compat.ts` dual-write layer is necessary but should be tracked for removal

**Impact:** Complexity that will become dead code.

Both `compat.ts` and the dual-write to legacy columns (`realm`, `ipa_account_expires`, `guest_expires_at`) are needed during the transition period. Once the legacy columns are dropped, `compat.ts` and all `legacyAccountColumnsFromCanonical` calls should be removed.

**Files:** `compat.ts` (entire file), referenced from `switching.ts`, `users.ts`, `local/users.ts`, `ipa/sync.ts`

---

## Open Questions / Assumptions

1. Does `providers.ipa.users.create()` UPSERT on the existing user row when switching local -> IPA? Or does it INSERT a new row?
2. Is the `getUserRow()` function sufficient for the validation needs of mutation functions, or do some genuinely need the full `SessionUser`?

## Conclusion

The user domain layer is functionally correct for the canonical model. The main concerns are performance (`get()` called too liberally) and the potential data integrity gap in `switchProvider()`. The dual-write legacy layer adds necessary but temporary complexity. The `buildBaseUser`/`toBaseUser` inconsistency should be unified.
