# Unified Account Backend — Code Review v2

**Date:** 2026-03-11
**Reviewer:** Claude Opus 4.6 (automated senior backend review)
**Scope:** Full re-review after fixes from v1 review and additional refactoring.

---

## 1. Executive Summary

The v2 codebase is a substantial improvement. The key v1 findings have been addressed:

- `accounts.users` is now the real read-owner for `get`, `getByUid`, and `list` (no more legacy aliases).
- `accounts.groups` does SQL-first listing and unified search.
- Legacy mirror logic is centralized in `compat.ts`.
- `demoteToGuest` is now atomic (delegates to `providers.ipa.users.demoteToGuest` which uses a DB transaction).
- `me.ts` PATCH now routes through `accounts.users.update`.
- `switchProvider` to local now invalidates sessions.
- Sync now uses the canonical `local_guest_expires_days` setting.

**However, this review found one critical authorization regression introduced during the cleanup, plus several medium-severity bugs and security concerns.**

---

## 2. Review Scope

Same file set as v1, plus new files:

- `packages/core/src/services/accounts/compat.ts` (57 lines) — new legacy compatibility layer
- `packages/core/src/services/ipa/profile.ts` (86 lines) — replaces old `realm.ts`
- `packages/core/src/api/admin-account-lifecycle.ts` (262 lines) — admin lifecycle API

---

## 3. Findings

### F-01 — CRITICAL: Local users locked out of accounts API by role regression

| | |
|---|---|
| **Severity** | Critical |
| **Category** | Authorization / regression |
| **Impact** | All `local/user` accounts are denied access to user listing, group listing, group search, and group member management endpoints. The entire accounts management UI is inaccessible to local users. |

**Explanation:**

The `buildRoles` function in `authz.ts` was simplified to remove the compatibility role that granted the `ipa` role to `local/user` accounts.

**Old code (v1):**
```ts
// Compatibility roles
if (profile === "user" && provider === "local") roles.add("ipa");
```

**New code (v2, `authz.ts:1-22`):**
```ts
roles.add(profile);    // "user"
roles.add(provider);   // "local"
roles.add(`${provider}/${profile}`);  // "local/user"
// No ipa compatibility role
```

A `local/user` now gets roles: `["user", "local", "local/user"]`.

**But the API routes still gate on `requireRole("ipa")`:**
- `accounts/api/users.ts` — `GET /` uses `auth.requireRole("ipa")`
- `accounts/api/groups.ts:54` — `GET /:id/search` uses `auth.requireRole("ipa")`
- `accounts/api/groups.ts:108` — `GET /` uses `auth.requireRole("ipa")`
- `accounts/api/groups.ts:159` — `POST /:id/members` uses `auth.requireRole("ipa")`
- `accounts/api/groups.ts:197` — `DELETE /:id/members` uses `auth.requireRole("ipa")`

The auth middleware (`auth.ts:120`) does a direct `user.roles.includes(role)` check. Since `local/user` no longer has `"ipa"` in their roles, **all these endpoints return 403 Forbidden for local users**.

**Fix options:**
1. Change these routes from `requireRole("ipa")` to `requireRole("user")` (allows all non-guest users).
2. Re-add the compatibility role in `authz.ts`.

**Files:**
- `packages/core/src/services/accounts/authz.ts:1-22`
- `packages/apps/src/accounts/api/users.ts` (GET / route)
- `packages/apps/src/accounts/api/groups.ts:54,108,159,197`
- `packages/lib/src/server/middleware/auth.ts:120`

---

### F-02 — MEDIUM: `getMembers`/`getManagers`/`getParents`/`getManagedGroups` fall through to IPA provider for non-existent groups

| | |
|---|---|
| **Severity** | Medium |
| **Category** | Bug / data correctness |
| **Impact** | If a group ID does not exist, these read operations silently delegate to the IPA provider instead of returning empty results. Could return misleading data or produce unexpected errors. |

**Explanation:**

In `accounts/groups.ts`, these four functions follow the same pattern:

```ts
export const getMembers = async (params) => {
  const provider = await resolveProvider(params.id);
  if (provider === "local") return localGroups.getMembers(params);
  return providers.ipa.groups.getMembers(params);  // ← falls through when provider is null
};
```

`resolveProvider` returns `null` when the group doesn't exist (`SELECT provider FROM auth.groups WHERE id = ...` returns no rows). The `null` case is not `"local"`, so it falls through to the IPA provider. The IPA provider will then query for a group that doesn't exist in IPA's scope, likely returning empty results — but the behavior is incorrect and provider-biased.

Compare with mutation functions like `update`, `remove`, `addMember` which correctly handle the null provider case by checking for IPA explicitly and returning 401 when no IPA session is provided.

**Files:**
- `packages/core/src/services/accounts/groups.ts:288-310` (getMembers, getManagers, getParents, getManagedGroups)

**Fix:** Add explicit `null` check: `if (!provider) return [];`

---

### F-03 — MEDIUM: `switchProvider` IPA-to-local path is non-transactional across three destructive operations

| | |
|---|---|
| **Severity** | Medium |
| **Category** | Data integrity |
| **Impact** | If the DB UPDATE fails after the FreeIPA user has been deleted, the user is left in an inconsistent state: IPA user gone, but local DB still shows `provider='ipa'`. Recovery requires manual intervention. |

**Explanation:**

`switchProvider` in `accounts/users.ts:631-677` performs three sequential operations without a transaction:

1. `freeipa.client.call(ipaSession, "user_del", ...)` — **irreversible** IPA deletion
2. `clearUserRelationsForProvider(...)` — two separate DELETEs (`switching.ts`)
3. `sql UPDATE auth.users SET provider = 'local', ...`

If step 3 fails (e.g., DB connection error, constraint violation), the IPA user is already deleted but the DB row still says `provider='ipa'`. The next IPA sync would treat this user as stale and potentially demote/delete them, but between the failure and the next sync, the user is in a broken state.

Steps 2 and 3 should be wrapped in `sql.begin()`. Step 1 (IPA deletion) must remain outside the transaction since it's a remote call.

**Files:**
- `packages/core/src/services/accounts/users.ts:631-668`
- `packages/core/src/services/accounts/switching.ts:8-24` (two non-transactional DELETEs)

---

### F-04 — MEDIUM: No cycle detection in local group nesting

| | |
|---|---|
| **Severity** | Medium |
| **Category** | Bug / data integrity |
| **Impact** | A circular group nesting (A→B→A, or A→B→C→A) can be created, causing infinite recursion in all `WITH RECURSIVE` CTEs used for group traversal (member listing, parent listing, management computation). This would result in query timeouts or excessive resource consumption. |

**Explanation:**

`local-groups.ts:356-360` allows adding any local group as a child of another local group:

```ts
if (params.group) {
  const isLocal = await ensureLocalGroupTreeMember(params.group);
  if (!isLocal) return { ok: false, error: "Only local groups can be nested" };
  await sql`INSERT INTO auth.group_groups_v2 (parent_group_id, child_group_id)
            VALUES (${group.id}, ${params.group}) ON CONFLICT DO NOTHING`;
}
```

There is no check for whether the new child group is already an ancestor of the parent group. IPA groups are protected by FreeIPA's own cycle detection, but local groups have no such protection.

A cycle would break these queries:
- `getMembers` recursive CTE (`local-groups.ts`)
- `getParents` recursive CTE
- `getManagedGroups` recursive CTE
- `getGroups` and `getManagedGroups` in `accounts/users.ts`
- `buildIpaGroupScopeCondition` in `accounts/groups.ts`

PostgreSQL's `WITH RECURSIVE` has a default `work_mem` limit that would eventually terminate the recursion, but not before consuming significant resources.

**Files:**
- `packages/core/src/services/accounts/local-groups.ts:356-360`

---

### F-05 — MEDIUM: `me.ts` self-delete passes potentially null `ipaSession` to `providers.ipa.users.remove`

| | |
|---|---|
| **Severity** | Medium |
| **Category** | Bug / type safety |
| **Impact** | For IPA guest users, if the IPA session has expired, the explicit `null` check at line 193 correctly returns 401. But the TypeScript type allows `null` to flow into the remove call at line 199, where `providers.ipa.users.remove` expects `ipaSession: string`. The null check guard is correct at runtime, but the type contract is violated. |

**Explanation:**

`me.ts:192-206`:
```ts
const ipaSession = user.provider === "ipa" ? await auth.session.getIpaSession(token) : null;
if (user.provider === "ipa" && !ipaSession) {
  return c.json({ message: "IPA session required." }, 401);
}

const result = user.provider === "ipa"
  ? await providers.ipa.users.remove({
      ipaSession,  // ← type is string | null, expects string
      id: user.id,
      actor: { userId: user.id, uid: user.uid },
    })
  : ...
```

While the runtime guard on line 193 ensures `ipaSession` is non-null when we reach line 199, TypeScript's narrowing doesn't carry through the ternary. If `providers.ipa.users.remove` internally passes `ipaSession` to `freeipa.client.call` as `null`, the FreeIPA call would fail with an unhelpful error rather than a clean 401.

This is not exploitable but is a correctness/robustness concern.

**Files:**
- `packages/core/src/api/me.ts:192-206`

---

### F-06 — LOW: Search without groupId only returns IPA entities

| | |
|---|---|
| **Severity** | Low |
| **Category** | Behavioral inconsistency |
| **Impact** | When searching for users/groups without a group context (the `_` sentinel in the API), only IPA users and IPA groups are returned. Local users and local groups are excluded from the search results. |

**Explanation:**

`accounts/service/groups.ts:22-42`:
```ts
search: async (config) =>
  config.groupId
    ? accounts.groups.search({...})  // ← unified search (both providers)
    : providers.ipa.groups.search(config.query, {...})  // ← IPA-only search
```

When `groupId` is absent (the common case for the autocomplete search on the "new group" or "add member" dialogs), the search falls back to `providers.ipa.groups.search` (`ipa/search.ts`), which only queries `auth.users WHERE provider = 'ipa'` and `auth.groups WHERE provider = 'ipa'`.

The unified `accounts.groups.search` (`accounts/groups.ts:241-268`) handles both providers when given a `groupId` (resolves the provider and passes it to `searchGroups`). But when called without a `groupId`, it passes `provider: undefined` which makes `searchGroups` search across all providers.

The fix is likely to call `accounts.groups.search` in both cases, passing an undefined `groupId`.

**Files:**
- `packages/apps/src/accounts/service/groups.ts:22-42`
- `packages/core/src/services/ipa/search.ts` (IPA-only search)

---

### F-07 — LOW: `ReminderAuditSchema.kind` enum mismatch in admin API

| | |
|---|---|
| **Severity** | Low |
| **Category** | Schema / correctness |
| **Impact** | The admin API's `ReminderAuditSchema` defines `kind` as `z.enum(["ipa_expiry", "guest_expiry"])` but the actual `ReminderKind` type in the lifecycle code is `"account_expiry"`. The response schema would fail validation if clients check against the declared enum. |

**Files:**
- `packages/core/src/api/admin-account-lifecycle.ts:30` (schema definition)
- `packages/core/src/services/account-lifecycle/index.ts:19` (actual `ReminderKind = "account_expiry"`)

---

### F-08 — LOW: `logs.retention_days` setting used but not registered

| | |
|---|---|
| **Severity** | Low |
| **Category** | Configuration |
| **Impact** | The setting `logs.retention_days` is read by the log cleanup scheduler job (`scheduler.ts:169`) but is not registered in `SETTINGS` (`defaults.ts`). It won't appear in the admin settings UI and cannot be configured through the settings API. The hardcoded fallback of 30 days is always used. |

**Files:**
- `packages/core/src/services/account-lifecycle/scheduler.ts:169`
- `packages/core/src/services/settings/defaults.ts` (missing registration)

---

### F-09 — LOW: Variable shadowing of `session` import in `sync.ts`

| | |
|---|---|
| **Severity** | Low |
| **Category** | Code quality / latent bug |
| **Impact** | In `syncUser` (`sync.ts:555`), a local variable `const session = await freeipa.session.getServiceSession()` shadows the imported `session` from `@valentinkolb/cloud-core/services/session`. Currently harmless because `syncUser` does not call `session.deleteAllForUser`, but if someone adds session revocation to `syncUser` in the future, they would accidentally call `freeipa.session.deleteAllForUser` instead of `session.deleteAllForUser`. |

**Files:**
- `packages/core/src/services/ipa/sync.ts:555` (variable shadowing)
- `packages/core/src/services/ipa/sync.ts:11` (original import)

---

## 4. Improvements Since v1

The following v1 findings have been resolved:

| v1 ID | v1 Title | Status |
|-------|----------|--------|
| F-01 | Missing session invalidation after switchProvider to local | **Fixed** — `accounts/users.ts:671-675` now calls `session.deleteAllForUser` |
| F-02 | Admin demoteToGuest is non-atomic | **Fixed** — Now delegates to `providers.ipa.users.demoteToGuest` which uses a DB transaction |
| F-03 | /me profile update bypasses unified accounts layer | **Fixed** — `me.ts:75` now calls `accounts.users.update` |
| F-04 | Sync uses legacy guest expiry setting key | **Fixed** — `sync.ts:210` now reads `user.account.local_guest_expires_days` |
| F-05 | Session manages array only includes IPA groups | **Fixed** — `accounts/users.ts:220-260` now includes both providers in manages CTE |
| F-06 | Duplicate guest creation paths | **Improved** — Legacy IPA module now routes through providers layer. Two paths remain but are better aligned. |
| F-07 | Local group getMembers silently ignores recursive | Still present — see F-02 v2 (different issue). Local groups still don't support recursive member listing. |
| F-08 | show_all on groups lacks admin check | **Unchanged** — Still available to all `ipa` role users. Likely intentional for group discovery. |

Additionally:
- `accounts.users.get` is now the real implementation (heavy SQL with recursive CTEs), no longer a re-export of legacy code.
- `accounts.users.list` now queries directly with `provider`/`profile` filters instead of translating to legacy `realm[]`.
- `accounts.groups.list` is now a proper SQL query (`listCanonical`) instead of the old in-memory merge approach.
- Legacy compatibility code is centralized in `compat.ts` with `legacyAccountColumnsFromCanonical`.
- The `ipa/index.ts` facade now delegates to the providers layer, not to sibling files.

---

## 5. Open Questions / Assumptions

### Q1 — What role should replace `requireRole("ipa")` for unified access?

The most natural replacement is `requireRole("user")` (the profile role, shared by all non-guest accounts regardless of provider). This would allow `local/user`, `ipa/user`, and admin accounts to access the endpoints, while keeping guests out. Alternatively, a new `"accounts"` or `"member"` role could be introduced, but this adds complexity.

### Q2 — Should search without groupId return local entities?

The current fallback to `providers.ipa.groups.search` appears to be a compatibility adapter. If the intent is that local users and groups should be discoverable in autocomplete dialogs (e.g., when adding a member to a new group), the unified search should be used unconditionally.

### Q3 — Is PostgreSQL's recursive CTE safety sufficient for cycle protection?

PostgreSQL does not natively detect cycles in `WITH RECURSIVE` — it relies on the query eventually exhausting `work_mem` or hitting a `LIMIT`. A self-referencing group nesting could cause significant CPU/memory consumption before termination. A CHECK trigger on `group_groups_v2` or an application-level cycle check before INSERT is recommended.

---

## 6. KISS Assessment

### Improvements over v1

1. **`compat.ts` is clean and focused.** Legacy dual-write logic is centralized in 57 lines instead of being scattered across 10+ files.
2. **`accounts.users.get` owns its query.** No more re-exporting from the legacy module. The query includes both providers' groups and managers in a single SQL call.
3. **`accounts.groups.listCanonical` is a proper SQL query.** The old in-memory merge of two provider-specific lists is gone.
4. **`authz.ts` is simpler (22 lines).** Roles are derived from the canonical `provider` and `profile` fields directly, without compatibility translations.
5. **The `ipa/index.ts` facade delegates to `providers`** instead of mixing direct imports and provider references.

### Remaining complexity

1. **`ipa/users.ts` is still 1083 lines** of mixed read and mutation logic. The read functions (`get`, `getByUid`, `list`, etc.) are now also implemented in `accounts/users.ts`, creating ownership confusion. The legacy `ipa/users.ts` reads are still exported but it's unclear if they're still called anywhere (other than through the providers re-export barrel).
2. **Two `buildBaseUser` / `buildSessionUser` implementations** exist: one in `accounts/users.ts` (the new canonical one) and one in `ipa/users.ts` (the legacy one). If both are still reachable at runtime, the two implementations must stay in sync — a DRY violation.
3. **`searchGroups` in `accounts/groups.ts` is provider-aware but incomplete.** It handles IPA-only filtering when `provider === "ipa"` but doesn't fully leverage the unified model for the no-provider case.

### Overall

The codebase is measurably simpler than v1. The canonical ownership is clearer, the compatibility layer is well-contained, and the major architectural concerns from v1 are resolved. The critical F-01 finding is a cleanup oversight, not a structural problem.

---

## 7. Overall Verdict

**The architecture is sound and substantially improved.** The unified account model is correctly implemented with proper FreeIPA-first ordering, identity preservation, canonical expiry handling, and centralized compatibility writes.

**One critical regression must be fixed before this can ship:**

- **F-01 (Critical):** The removal of the `ipa` compatibility role from `local/user` breaks access to all accounts API endpoints for local users. This is a one-line fix in either `authz.ts` or in the affected route definitions.

**Three medium findings should be addressed:**

- **F-02:** Add null-provider guards to `getMembers`/`getManagers`/`getParents`/`getManagedGroups`.
- **F-03:** Wrap the post-IPA-deletion DB operations in `switchProvider` in a transaction.
- **F-04:** Add cycle detection to local group nesting.

### Priority order

1. **F-01** — Fix the role regression (critical, blocks all local users)
2. **F-02** — Add null guards to group read functions (quick fix)
3. **F-03** — Wrap switchProvider DB operations in a transaction
4. **F-04** — Add cycle detection for local group nesting
5. **F-06** — Unify search to include local entities when no groupId
6. **F-07** — Fix ReminderAuditSchema enum mismatch
7. **F-08** — Register `logs.retention_days` setting
8. **F-09** — Rename shadowed variable in sync.ts
