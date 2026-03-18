# Module Review: IPA Provider — Groups & Sync

## Scope

`packages/core/src/services/ipa/groups.ts` (638 lines)
`packages/core/src/services/ipa/sync.ts` (596 lines)

IPA group CRUD with local DB mirroring and full bidirectional IPA sync.

---

## Findings

### IG-01 | medium | `removeMember` for groups has N+1 profile updates

**Impact:** Performance for group mutations affecting many users.

When removing a child group (`ipa/groups.ts:508-524`), the code queries all affected users then calls `updateUserIpaProfile()` for each one individually in a loop. This could be a single bulk UPDATE.

**Files:** `ipa/groups.ts:508-524`

---

### IG-02 | medium | No transaction wrapping on multi-step group mutations

**Impact:** Partial state if profile update fails after junction row insert.

`addMember` (lines 458-467) inserts the junction row then calls `updateUserIpaProfile` outside any transaction. If the profile update fails, the junction row is committed but the user's profile is stale until the next sync.

**Files:** `ipa/groups.ts:458-467`

---

### IG-03 | medium | Junction table rebuild is destructive during sync

**Impact:** Concurrent reads during sync see incomplete membership data.

`ipa/sync.ts:428-439` deletes ALL IPA junction rows then re-inserts them within a transaction. While this is correct (the `sql.begin` wraps it), the transaction isolation level determines whether concurrent reads see the intermediate state. Under Postgres default `READ COMMITTED`, other transactions could see the deleted state mid-sync.

**Files:** `ipa/sync.ts:428-439`

---

### IG-04 | medium | N+1 inserts for junction tables during sync

**Impact:** Performance for large deployments.

`ipa/sync.ts:445-478` inserts each user-group, group-group, manager-user, and manager-group relationship one at a time in a loop. For large deployments with thousands of relationships, this produces thousands of individual INSERT statements. Batch inserts (using `VALUES` with multiple rows) would be significantly faster.

**Files:** `ipa/sync.ts:445-478`

---

### IG-05 | medium | `syncUser()` doesn't update `last_login_ipa`

**Impact:** Missing login timestamp update during on-login sync.

`ipa/sync.ts:570-593` updates many user fields during on-login sync but does NOT include `last_login_ipa` in the SET clause. The full sync does update it (line 235). This means the `last_login_ipa` field is only updated during periodic full syncs, not at actual login time.

**Files:** `ipa/sync.ts:570-593` vs `ipa/sync.ts:235`

---

### IG-06 | low | FreeIPA deletion pattern duplicated 3 times

**Impact:** DRY violation.

The "delete from FreeIPA, handle 4001 not-found gracefully" pattern appears in:
- `ipa/users.ts:demoteToGuest()` (lines 939-948)
- `ipa/users.ts:deleteUser()` (lines 1041-1050)
- `lifecycle/index.ts:deleteFromFreeIpa()` (lines 126-135)

The lifecycle module correctly extracted this into a helper, but `ipa/users.ts` still has it inline twice.

**Files:** `ipa/users.ts:939-948, 1041-1050`, `lifecycle/index.ts:126-135`

---

### IG-07 | low | Stale user detection threshold is hardcoded

**Impact:** Not configurable -- the 20% safety threshold cannot be adjusted.

`ipa/sync.ts:204` calculates `staleLimit = max(10, ceil(max(localIpaUsers, 1) * 0.2))`. This prevents catastrophic mass-demotion if FreeIPA returns incomplete data, but the threshold is arbitrary and not exposed as a setting.

**Files:** `ipa/sync.ts:204`

---

### IG-08 | low | `del()` doesn't cascade-clean junction rows

**Impact:** Relies on DB foreign key cascades.

`ipa/groups.ts:386-395` deletes the group from `auth.groups` but does not explicitly clean up `user_groups_v2`, `group_groups_v2`, `group_manager_users_v2`, `group_manager_groups_v2`. Same concern as `local-groups.ts` (CG-06).

**Files:** `ipa/groups.ts:386-395`

---

### IG-09 | info | Re-export chain between `ipa/` and `providers/ipa/` is unnecessary

**Impact:** Complexity with no functional benefit.

`providers/ipa/*.ts` files re-export from `../../ipa/*`, then `ipa/index.ts` re-imports from `providers`. This creates a circular re-export topology. All real logic lives in `ipa/`. The `providers` layer only adds renaming aliases.

No external consumer was found importing from `@valentinkolb/cloud-core/services/ipa` directly. The chain exists for backward compatibility but adds no value.

**Files:** `providers/ipa/*.ts`, `ipa/index.ts`

---

## Open Questions / Assumptions

1. Should the junction table rebuild use a higher isolation level (e.g., `SERIALIZABLE`) to prevent mid-sync visibility issues?
2. Should `syncUser()` update `last_login_ipa`?
3. Should the stale user threshold be configurable via settings?

## Conclusion

The IPA groups and sync modules are the most operationally critical parts of the system. The sync is correct in its approach (delete-then-rebuild within a transaction) but has performance concerns for scale (N+1 inserts, N+1 profile updates). The missing `last_login_ipa` update in `syncUser()` is a likely bug. The FreeIPA deletion helper should be shared. The `providers/ipa/` re-export layer adds no value over direct imports.
