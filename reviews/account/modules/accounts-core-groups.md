# Module Review: Core Account Groups

## Scope

`packages/core/src/services/accounts/groups.ts` (431 lines)
`packages/core/src/services/accounts/local-groups.ts` (482 lines)

The group domain layer -- `groups.ts` is the provider-agnostic facade, `local-groups.ts` is the local-only implementation.

---

## Findings

### CG-01 | medium | `resolveProvider()` extra query before every group operation

**Impact:** Performance -- every group mutation starts with a separate `SELECT provider FROM auth.groups WHERE id = ...` before the actual operation queries the same row.

All mutation functions (`get`, `getMembers`, `getManagers`, `getParents`, `update`, `remove`, `makePosix`, `addMember`, `removeMember`, `addManager`, `removeManager`) call `resolveProvider()` first. For operations like `get()` that immediately query the same group row, this is a wasted round-trip.

**Files:** `groups.ts:11` (resolveProvider definition), called at entry of every function

---

### CG-02 | medium | `listCanonical()` runs complex WHERE clauses twice (count + data)

**Impact:** Performance for scoped group listings.

Lines 198-235 show identical WHERE clauses with recursive CTEs in both the count query and the data query. A single query with `COUNT(*) OVER()` window function would halve the work for complex scope conditions.

**Files:** `groups.ts:163-254`

---

### CG-03 | low | `local-groups.ts` LIKE escaping misses backslash

**Impact:** Minor bug -- searching for a group with `\` in the name would produce wrong results.

Line 107 escapes `%` and `_` manually but does not escape `\` itself. The `postgres.ts` utility `escapeLikePattern` correctly escapes all three characters. This is a DRY violation (3 different LIKE escaping approaches exist in the codebase).

**Files:** `local-groups.ts:107`, vs `postgres.ts:14` (correct version)

---

### CG-04 | low | Legacy `cn` column in local group creation

**Impact:** Unnecessary legacy data.

`local-groups.ts:83` constructs `const legacyCn = "local:" + params.name`. The `cn` column is the PRIMARY KEY of `auth.groups` (migration auth.ts line 152). Two groups with the same name but different providers could collide on `cn` if the prefix logic fails. The `cn` PK is documented as significant structural debt.

**Files:** `local-groups.ts:83-100`, migration `auth.ts:152`

---

### CG-05 | low | IPA users can be added to local groups (intentional but not obvious)

**Impact:** Potential confusion about provider boundary rules.

`local-groups.ts:377` calls `ensureLocalUserMembershipProvider` which returns the user's provider but does NOT enforce that the user is local. The function name suggests it would enforce local-only membership, but it accepts any provider. This is documented as intentional (local groups can contain both local and IPA users), but the function naming is misleading.

**Files:** `local-groups.ts:372-410`

---

### CG-06 | low | `remove()` relies on DB cascade without explicit cleanup

**Impact:** Orphaned junction rows if FK cascades are misconfigured.

`local-groups.ts:156-162` deletes a group without explicitly cleaning `user_groups_v2`, `group_groups_v2`, `group_manager_users_v2`, `group_manager_groups_v2`. This relies on `ON DELETE CASCADE` FKs. Same for IPA groups in `ipa/groups.ts:386-395`.

**Files:** `local-groups.ts:156-162`, `ipa/groups.ts:386-395`

---

## Open Questions / Assumptions

1. Is the `cn` PK constraint on `auth.groups` still needed by any query path, or only by the legacy V1 junction tables?
2. Should `ensureLocalUserMembershipProvider` be renamed to reflect that it allows cross-provider membership?
3. Are FK cascades actually set up for all V2 junction tables?

## Conclusion

The group layer correctly delegates to local or IPA providers. Main concerns are the extra `resolveProvider()` round-trip and the duplicate count+data query pattern. The legacy `cn` PK constraint is the most significant structural debt, forcing synthetic prefixes for local groups. Local groups correctly allow mixed-provider membership, which matches the documented intent.
