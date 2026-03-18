# System Simplification Review

## Scope

Whole-system pass across all account backend modules after the canonical migration. Focused on unnecessary code, duplicate logic, avoidable complexity, and opportunities to simplify without changing product behavior.

---

## 1. Unnecessary Code

### S-01 | `providers/ipa/` re-export layer serves no purpose

**Current state:** Every file in `providers/ipa/` is a 1-line re-export from `../../ipa/*`. Then `ipa/index.ts` re-imports from `providers/ipa/`, creating a circular re-export chain.

**Why it's unnecessary:** No external consumer imports from `providers/ipa/` or `ipa/index.ts` directly. The consuming code (in `accounts/users.ts`, `accounts/groups.ts`, `lifecycle/`) imports from `providers` which routes through both layers.

**Simplification:** The `providers/ipa/` layer should either (a) be removed entirely with `providers/index.ts` importing directly from `ipa/*`, or (b) the `ipa/index.ts` facade that loops back through providers should be removed. Either way, one layer can be eliminated.

**Files:** `providers/ipa/*.ts`, `ipa/index.ts`

---

### S-02 | `ipa/index.ts` backward-compatibility aliases are unused

**Current state:** `ipa/index.ts` adds aliases like `users.addIpa`, `users.delete`, `groups.delete` alongside the canonical `create`/`remove` names.

**Why it's unnecessary:** No external code imports these aliases. The `providers/ipa/users.ts` re-exports use the renamed versions (`create`/`remove`). The legacy names exist only for a compatibility that nothing consumes.

**Files:** `ipa/index.ts:8-9, 13`

---

### S-03 | `compat.ts` dual-write layer should be isolated with a removal plan

**Current state:** `legacyAccountColumnsFromCanonical` is called from 6+ locations across `local/users.ts`, `ipa/users.ts`, `ipa/sync.ts`, `switching.ts`. Every write path must compute and include legacy columns.

**Why it matters:** This adds 3-5 lines to every INSERT/UPDATE and makes it easy to forget one write path. The legacy columns (`realm`, `ipa_account_expires`, `guest_expires_at`) are redundant with `provider`, `profile`, `account_expires`.

**Simplification:** Extract dual-write into a single helper that wraps DB writes, making it impossible to forget. Track column removal behind a feature flag or migration step.

**Files:** `accounts/compat.ts`, all write paths in `local/users.ts`, `ipa/users.ts`, `ipa/sync.ts`, `switching.ts`

---

### S-04 | Legacy V1 junction tables are unused at runtime

**Current state:** `auth.user_groups`, `auth.group_groups`, `auth.group_manager_users`, `auth.group_manager_groups` (cn-based V1 tables) exist in the schema. The V2 tables (UUID-based) are the only ones used at runtime.

**Why it's unnecessary:** V1 tables served the old cn-based model. All runtime code uses V2 tables. V1 tables exist only for migration backward-compatibility.

**Simplification:** Add a migration step to drop V1 tables once all environments have been migrated.

**Files:** `migrate/core/auth.ts:229-340`

---

## 2. Duplicate Logic

### S-05 | Recursive group CTE appears 9+ times

**Current state:** The same recursive CTE pattern for traversing group hierarchy (via `auth.group_groups_v2`) appears in:
- `ipa/users.ts:get()` (2 instances)
- `ipa/users.ts:getGroups()`
- `ipa/users.ts:getManagedGroups()`
- `ipa/groups.ts:getMembers()`
- `ipa/groups.ts:getManagers()`
- `ipa/groups.ts:getParents()`
- `ipa/groups.ts:list()`
- `ipa/profile.ts:getAllUserGroups()`
- `accounts/groups.ts:buildMemberGroupScopeCondition()`
- `accounts/groups.ts:buildManagedGroupScopeCondition()`

**Simplification:** Extract a shared SQL fragment builder `recursiveGroupCTE(direction, startId)` that generates the appropriate `WITH RECURSIVE` clause. This would reduce ~200 lines of duplicated SQL to a single parameterized helper.

**Files:** All listed above

---

### S-06 | `buildBaseUser()` exists in two files with different logic

**Current state:** `accounts/users.ts:buildBaseUser()` and `accounts/groups.ts:toBaseUser()` both map DB rows to `BaseUser` but differ in displayName fallback logic.

**Simplification:** Unify into a single `buildBaseUser()` helper in a shared location (e.g., `accounts/model.ts`).

**Files:** `accounts/users.ts:128-151`, `accounts/groups.ts:16-40`

---

### S-07 | `getLocalExpiryDays()` duplicated

**Current state:** `switching.ts:37-45` and `users.ts:61-77` both read the same settings with the same defaults.

**Simplification:** Extract to a single helper in `model.ts` or `accounts/index.ts`.

**Files:** `switching.ts:37-45`, `users.ts:61-77`

---

### S-08 | FreeIPA "delete with not-found handling" pattern appears 3 times

**Current state:** `lifecycle/index.ts:deleteFromFreeIpa()` correctly extracts this. But `ipa/users.ts:demoteToGuest()` and `ipa/users.ts:deleteUser()` have it inline.

**Simplification:** Use the lifecycle helper everywhere, or extract to a shared `freeipa-utils` module.

**Files:** `lifecycle/index.ts:126-135`, `ipa/users.ts:939-948, 1041-1050`

---

### S-09 | LIKE escaping done 3 different ways

**Current state:**
- `local-groups.ts:107` -- manual `replaceAll` (misses backslash)
- `ipa/search.ts` and `ipa/users.ts` -- `freeipa.util.escapeLike`
- `postgres.ts:14` -- `escapeLikePattern`

**Simplification:** Use `postgres.ts:escapeLikePattern` everywhere. It correctly handles `%`, `_`, and `\`.

**Files:** `local-groups.ts:107`, `postgres.ts:14`

---

### S-10 | Account request SQL repeated 4 times in app.ts

**Current state:** `app.ts:496-603` has four nearly identical SQL query blocks for listing account requests with different status filters.

**Simplification:** Parameterize the WHERE clause based on status filter. One query function, one SQL template, conditional predicate.

**Files:** `app.ts:496-603`

---

## 3. Unnecessary Layers / Indirection

### S-11 | `accounts/groups.ts` is a thin delegation layer that mostly adds `resolveProvider()`

**Current state:** Almost every function in `accounts/groups.ts` does: (1) call `resolveProvider()`, (2) if IPA -> delegate to `providers.ipa.groups.*`, if local -> delegate to `localGroups.*`. The function signatures are passthrough.

**Why it matters:** This adds one layer of indirection (and one extra DB query) to every group operation. The caller already knows the group provider in many cases (the API layer fetches the group for access checks before calling the facade).

**Simplification:** Consider passing the resolved provider from the API layer into the facade, avoiding the redundant `resolveProvider()` query. Or collapse the facade into the API layer where provider routing is already done.

**Files:** `accounts/groups.ts` (entire file)

---

### S-12 | `app.ts` wraps `accounts/users.ts` which wraps `providers/*`

**Current state:** The call chain for a user mutation is: API -> `app.ts:user.create()` -> `accounts/users.ts:create()` -> `providers.local.users.create()` (or IPA). Three layers between the API and the actual implementation.

**Why it matters:** `app.ts` adds welcome email sending and request linking. `accounts/users.ts` adds provider routing. The layering is justified for separation of concerns, but it means tracing a flow requires reading 4 files.

**This is acceptable complexity** given that each layer has a distinct responsibility. Not recommending a change, but noting it for awareness.

---

### S-13 | `account-model.ts` is a pure re-export barrel

**Current state:** `core/services/account-model.ts` (12 lines) re-exports everything from `accounts/model.ts` and `accounts/authz.ts`. This exists for import convenience.

**Simplification:** This is fine -- barrel files are standard. No action needed.

---

## 4. Where KISS Is Still Violated

### S-14 | `get()` used for existence checks

**Current state:** `accounts/users.ts:get()` runs a massive query with 4 subqueries and 2 recursive CTEs. It's called ~12 times in mutation functions that only need "does this user exist and what's their provider?"

**Simplification:** Add a `getMinimal(id)` function that returns `{ id, uid, provider, profile, mail, accountExpires }` without group resolution. Use it in mutation guards. Reserve `get()` for session loading and admin detail views.

**Files:** `accounts/users.ts:201-269`

---

### S-15 | Group operations triple-fetch the group

**Current state:** For a single group mutation through the API: (1) API fetches group for access check, (2) `requireLocalGroupManageAccess` fetches again, (3) `groups.ts` facade calls `resolveProvider()`. Three queries for the same group.

**Simplification:** Fetch the group once in the API layer, pass it through to the facade and access check.

**Files:** `api/groups.ts:50-58`, `accounts/groups.ts` (resolveProvider)

---

### S-16 | N+1 junction inserts during sync

**Current state:** `ipa/sync.ts:445-478` inserts junction table rows one at a time in a loop.

**Simplification:** Use batch INSERT with multiple VALUES rows. PostgreSQL handles this efficiently. Could reduce thousands of round-trips to a handful.

**Files:** `ipa/sync.ts:445-478`

---

### S-17 | N+1 profile updates after group membership changes

**Current state:** `ipa/profile.ts:updateProfileForAffectedUsers()` and `ipa/groups.ts:removeMember()` loop through affected users calling `updateUserIpaProfile()` individually.

**Simplification:** A single UPDATE with a subquery that recalculates profiles for all affected users in one statement.

**Files:** `ipa/profile.ts:68-84`, `ipa/groups.ts:508-524`

---

## 5. Legacy Residue

### S-18 | `auth.groups.cn` as PRIMARY KEY

**Current state:** The `cn` column is still the PRIMARY KEY of `auth.groups`. All UUID-based operations work around this by using `auth.groups.id` (which is a regular column with an index, not the PK). Local groups get synthetic `local:` prefixes for cn.

**Impact:** This prevents clean UUID-only group identity and forces legacy cn computation on every group create.

**Simplification:** Migrate PK from `cn` to `id`. This is a significant migration but eliminates the most impactful piece of structural debt.

---

### S-19 | `auth.access.group_cn` alongside `group_id`

**Current state:** The access table has both `group_cn` (legacy) and `group_id` (new). Both are populated. Queries use `group_id`.

**Simplification:** Drop `group_cn` column after verifying all queries use `group_id`.

---

### S-20 | `"ipa-limited"` role in contract enum

**Current state:** `RoleSchema` includes `"ipa-limited"` which is never produced by canonical role generation.

**Simplification:** Remove from the enum once all frontends are confirmed to not reference it.

**Files:** `contracts/shared.ts:6`

---

## Summary Table

| ID | Category | Effort | Impact | Priority |
|----|----------|--------|--------|----------|
| S-05 | Duplicate CTE | Medium | High (maintenance) | High |
| S-14 | KISS (get() overuse) | Low | High (performance) | High |
| S-15 | KISS (triple fetch) | Low | Medium (performance) | High |
| S-01 | Unnecessary layer | Low | Medium (clarity) | Medium |
| S-03 | Legacy isolation | Medium | Medium (safety) | Medium |
| S-10 | Duplicate SQL | Low | Medium (maintenance) | Medium |
| S-06 | Duplicate helper | Low | Low (consistency) | Medium |
| S-07 | Duplicate config | Low | Low (maintenance) | Medium |
| S-08 | Duplicate pattern | Low | Low (maintenance) | Medium |
| S-09 | Duplicate escaping | Low | Low (bug fix) | Medium |
| S-16 | N+1 sync inserts | Medium | Medium (performance) | Medium |
| S-17 | N+1 profile updates | Medium | Medium (performance) | Medium |
| S-18 | Legacy PK | High | High (structural) | Low (risk) |
| S-02 | Dead aliases | Trivial | Trivial | Low |
| S-04 | Dead tables | Low | Low | Low |
| S-19 | Dead column | Low | Low | Low |
| S-20 | Dead enum value | Trivial | Trivial | Low |

---

## Conclusion

The account backend is functionally coherent after the migration. The canonical `(provider, profile)` model is implemented correctly across all layers. The main simplification opportunities are:

1. **Performance:** Reduce the `get()` weight for mutation guards (S-14), eliminate triple-fetch in group operations (S-15), and batch sync inserts (S-16).
2. **DRY:** Extract the recursive group CTE (S-05), unify BaseUser builders (S-06), and consolidate the account request SQL (S-10).
3. **Cleanup:** Remove the `providers/ipa/` re-export layer (S-01), use the shared LIKE escaper everywhere (S-09), and plan the legacy column removal (S-03).
4. **Structural debt:** The `cn` PK on `auth.groups` (S-18) is the deepest piece of debt but carries migration risk.

None of these require product changes. All are internal quality improvements that make the codebase easier to maintain, debug, and scale.
