# Unified Account Backend — Code Review

**Date:** 2026-03-11
**Reviewer:** Claude Opus 4.6 (automated senior backend review)
**Scope:** Full backend review of the unified account model, provider switching, sync, lifecycle, authorization, and session handling.

---

## 1. Executive Summary

The unified account backend is well-architected and largely correct. The migration from the legacy realm-based model to the canonical `provider + profile + accountExpires` model has been implemented carefully, with consistent FreeIPA-first mutation ordering, proper identity preservation on provider switches, and a clear separation between the unified accounts layer and the provider-specific modules.

No critical security vulnerabilities or data-loss bugs were found. The most significant issues are:

- A missing session invalidation path after provider switching to local.
- A non-atomic demotion path in the admin API.
- The `/me` profile update endpoint bypassing the unified accounts dispatch layer.
- Inconsistent use of canonical vs legacy settings keys across sync and lifecycle code.

The codebase carries deliberate legacy compatibility residue (realm column, dual expiry writes, compatibility roles). This is documented and acceptable as transitional debt. The overall complexity is justified by the migration requirements.

---

## 2. Review Scope

### Files analyzed (non-exhaustive)

**Core account domain:**
- `packages/core/src/services/accounts/users.ts` (483 lines)
- `packages/core/src/services/accounts/groups.ts` (386 lines)
- `packages/core/src/services/accounts/local-groups.ts` (313 lines)
- `packages/core/src/services/accounts/model.ts` (71 lines)
- `packages/core/src/services/accounts/authz.ts` (34 lines)
- `packages/core/src/services/accounts/switching.ts` (25 lines)

**Provider modules:**
- `packages/core/src/services/providers/local/users.ts` (254 lines)
- `packages/core/src/services/providers/local/auth.ts` (13 lines)
- `packages/core/src/services/providers/ipa/` (thin wrappers delegating to legacy)

**Legacy IPA modules (still active):**
- `packages/core/src/services/ipa/users.ts` (1199 lines)
- `packages/core/src/services/ipa/groups.ts` (605 lines)
- `packages/core/src/services/ipa/sync.ts` (617 lines)
- `packages/core/src/services/ipa/auth.ts` (76 lines)
- `packages/core/src/services/ipa/realm.ts` (91 lines)

**Auth flows and session:**
- `packages/core/src/services/auth-flows/magic-link.ts` (83 lines)
- `packages/core/src/services/auth-flows/ipa.ts` (88 lines)
- `packages/core/src/services/session/index.ts` (100 lines)

**Lifecycle and scheduler:**
- `packages/core/src/services/account-lifecycle/index.ts` (843 lines)
- `packages/core/src/services/account-lifecycle/scheduler.ts` (335 lines)
- `packages/core/src/services/account-lifecycle/audit.ts` (37 lines)

**API and app service layer:**
- `packages/apps/src/accounts/api/users.ts` (431 lines)
- `packages/apps/src/accounts/api/groups.ts` (426 lines)
- `packages/apps/src/accounts/service/users.ts` (238 lines)
- `packages/apps/src/accounts/service/groups.ts` (238 lines)
- `packages/apps/src/accounts/service/admin.ts` (140 lines)

**Contracts, schema, middleware:**
- `packages/contracts/src/shared.ts` (182 lines)
- `packages/apps/src/accounts/contracts.ts` (68 lines)
- `packages/core/src/migrate/core/auth.ts` (768 lines)
- `packages/core/src/services/settings/defaults.ts` (331 lines)
- `packages/core/src/api/auth.ts` (176 lines)
- `packages/core/src/api/me.ts` (219 lines)
- `packages/lib/src/server/middleware/auth.ts` (150 lines)

---

## 3. Findings

### F-01 — Missing session invalidation after `switchProvider` to local

| | |
|---|---|
| **Severity** | Medium |
| **Category** | Session handling |
| **Impact** | After switching an IPA user to local, the user retains their app session containing a stale IPA session cookie. Subsequent IPA-dependent operations may produce confusing errors rather than a clean re-auth prompt. |

**Explanation:**

`switchProvider` in `accounts/users.ts:417-458` (the IPA-to-local path) deletes the FreeIPA user, clears IPA relations, updates the DB row to `provider='local'`, but does **not** call `session.deleteAllForUser(userId)`.

In contrast, the reverse path (local-to-IPA) triggers session invalidation via `providers.ipa.users.create` → `ipa/users.ts:661` (`session.deleteAllForUser(guestId)`).

The lifecycle code (`account-lifecycle/index.ts:302-303`) correctly invalidates sessions after automatic demotion.

**Security risk:** Low. The auth middleware reloads the user from the DB on every request, so roles are recalculated correctly. The stale IPA session cookie is harmless because it's only extracted for explicit IPA operations, which would fail at the FreeIPA level. But the user experience is degraded — they should be prompted to re-authenticate.

**Files:**
- `packages/core/src/services/accounts/users.ts:417-458`
- Compare: `packages/core/src/services/ipa/users.ts:661` (does invalidate)
- Compare: `packages/core/src/services/account-lifecycle/index.ts:302` (does invalidate)

---

### F-02 — Admin `demoteToGuest` is non-atomic (two sequential mutations)

| | |
|---|---|
| **Severity** | Medium |
| **Category** | Data integrity |
| **Impact** | If the second mutation fails, the user is stuck as `local/user` instead of `local/guest`. No rollback occurs. |

**Explanation:**

The service layer `demoteToGuest` (`accounts/service/users.ts:209-216`) is a composite:

```typescript
demoteToGuest: async (config) => {
  const switched = await usersService.switchProvider({ ..., provider: "local" });
  if (!switched.ok) return switched;
  return usersService.setProfile({ id: config.id, profile: "guest" });
},
```

This performs two independent mutations: `switchProvider("local")` then `setProfile("guest")`. If the first succeeds but the second fails (e.g., DB error), the user ends up as `local/user` with IPA relations already cleared and the FreeIPA user already deleted. Recovery requires manual intervention.

In contrast, the automated lifecycle code (`account-lifecycle/index.ts:126-163`, `demoteUserToGuest`) performs the demotion atomically in a single SQL transaction.

**Files:**
- `packages/apps/src/accounts/service/users.ts:209-216`
- Compare: `packages/core/src/services/account-lifecycle/index.ts:126-163` (atomic)

---

### F-03 — `/me` profile update bypasses unified accounts dispatch layer

| | |
|---|---|
| **Severity** | Medium |
| **Category** | Architecture / maintainability |
| **Impact** | The self-service profile update for all users goes through `providers.ipa.users.update` (the legacy `updateProfile`) instead of `accounts.users.update`, creating a parallel execution path that could silently diverge. |

**Explanation:**

`me.ts:74` calls:
```typescript
const result = await providers.ipa.users.update({
  ipaSession,
  id: user.id,
  data,
});
```

This routes to `ipa/users.ts:updateProfile`, which handles both IPA and local users internally. It works today because `updateProfile` falls through to a generic DB update for local users.

However, `accounts.users.update` (`accounts/users.ts:280-301`) dispatches by provider:
- IPA → `providers.ipa.users.update` (same legacy function)
- Local → `providers.local.users.update` (the new provider module)

The divergence: `updateProfile` sets `synced_at = now()` for all providers (line 833), while `providers.local.users.update` does not. Also, `providers.local.users.update` includes a `WHERE provider = 'local'` guard (line 117), while `updateProfile` uses `WHERE id = ${id}` without a provider guard (line 834), creating a minor TOCTOU risk.

**Files:**
- `packages/core/src/api/me.ts:74`
- `packages/core/src/services/ipa/users.ts:778-842`
- `packages/core/src/services/accounts/users.ts:280-301`
- `packages/core/src/services/providers/local/users.ts:103-137`

---

### F-04 — IPA sync uses legacy guest expiry setting key for stale user demotion

| | |
|---|---|
| **Severity** | Low |
| **Category** | Configuration inconsistency |
| **Impact** | Sync-demoted users may get a different guest expiry than lifecycle-demoted or admin-demoted users if only the canonical setting key has been updated. |

**Explanation:**

`sync.ts:212` reads:
```typescript
const guestExpiresDays = await settings.get<number | null>("user.account.guest_expires_days");
```

This is the **legacy** setting key. The lifecycle code (`account-lifecycle/index.ts:53-59`, `getGuestExpiresDays`) reads the canonical key first:
```typescript
const configured = await getSetting<number | string | null>("user.account.local_guest_expires_days");
// ... falls back to legacy key
```

If an admin updates `user.account.local_guest_expires_days` but not the legacy `user.account.guest_expires_days`, sync demotion and lifecycle demotion would compute different expiry dates.

**Files:**
- `packages/core/src/services/ipa/sync.ts:212`
- `packages/core/src/services/account-lifecycle/index.ts:53-59`

---

### F-05 — Session user `manages` array only includes IPA groups

| | |
|---|---|
| **Severity** | Low |
| **Category** | Role model inconsistency |
| **Impact** | Users who only manage local groups do not receive the `group-manager` role in their session. This does not cause a functional bug because local group management is checked dynamically, but it makes the role model incomplete. |

**Explanation:**

The `get` function in `ipa/users.ts:82-101` builds the `manages` array with a recursive CTE filtered to `g.provider = 'ipa'`. Local group management is excluded.

In `authz.ts:29`, the `group-manager` role is assigned when `manages.length > 0`. A user who manages only local groups will have `manages = []` and no `group-manager` role.

This is safe because `requireLocalGroupManageAccess` in `accounts/api/groups.ts:29-47` performs dynamic authorization for local groups, querying `accounts.users.getManagedGroups` (which returns both providers). But the inconsistency means the `group-manager` role is effectively "IPA group manager" only.

**Files:**
- `packages/core/src/services/ipa/users.ts:82-101` (IPA-only filter)
- `packages/core/src/services/accounts/authz.ts:29` (role assignment)
- `packages/apps/src/accounts/api/groups.ts:29-47` (dynamic check, correct)

---

### F-06 — Duplicate guest creation paths with subtly different logic

| | |
|---|---|
| **Severity** | Low |
| **Category** | DRY violation |
| **Impact** | Two distinct code paths create local guest users with similar but not identical behavior, increasing the risk of silent divergence. |

**Explanation:**

1. `ipa/users.ts:addGuest` (lines 412-453) — used by the `ipa` service facade (`ipa/index.ts`), referenced from the magic link auth flow (`auth-flows/magic-link.ts`).
2. `providers/local/users.ts:createGuest` (lines 76-101) — the new canonical provider module.

Both create local guest users, but:
- `addGuest` uses a raw INSERT with `RETURNING *` and builds a `BaseUser`.
- `createGuest` delegates to `create()` with `RETURNING id` and returns only `{ id }`.
- Settings fallback logic is similar but not extracted into a shared helper.

**Files:**
- `packages/core/src/services/ipa/users.ts:412-453`
- `packages/core/src/services/providers/local/users.ts:76-101`

---

### F-07 — Local group `getMembers`/`getManagers` silently ignores `recursive` parameter

| | |
|---|---|
| **Severity** | Low |
| **Category** | Behavioral inconsistency |
| **Impact** | Requesting recursive member listing for local groups returns non-recursive results without warning. |

**Explanation:**

`accounts/groups.ts` passes `recursive` through to `localGroups.getMembers`, but `local-groups.ts:137` has no recursive CTE — it always returns direct members only. The IPA path supports recursion via the IPA provider module.

This means `recursive=true` for a local group silently returns non-recursive results. Whether this matters depends on how deeply local groups are nested.

**Files:**
- `packages/core/src/services/accounts/local-groups.ts:137-169`
- `packages/core/src/services/accounts/groups.ts` (passes `recursive` through)

---

### F-08 — `show_all=true` on groups list endpoint lacks admin check

| | |
|---|---|
| **Severity** | Low |
| **Category** | Authorization |
| **Impact** | Any user with the `ipa` role can see all groups (IPA and local) via `GET /groups?show_all=true`. |

**Explanation:**

The groups list endpoint (`accounts/api/groups.ts:108`) requires `requireRole("ipa")`. The `show_all=true` parameter removes user-scoping (`userId: undefined`), exposing all groups to any IPA user.

This is likely **intentional** for group discovery (users need to see groups to request membership). But if local groups are intended to be hidden from non-admin IPA users, this would be a gap.

**Files:**
- `packages/apps/src/accounts/api/groups.ts:108-154`

---

## 4. Open Questions / Assumptions

### Q1 — Is the `ipa` compatibility role on `local/user` intentional for all permission checks?

`authz.ts:24` grants the `ipa` role to `local/user` accounts. This means local users pass any `requireRole("ipa")` check. The comment says "Compatibility roles used widely across the existing app surface." This is documented, but any route that should be restricted to actual FreeIPA users (e.g., password reset, SSH key management) must check `provider` directly, not rely on the `ipa` role. The security review (`13_ACCOUNT_BACKEND_SECURITY_REVIEW.md`) acknowledges this.

### Q2 — Should `switchProvider` clear the old provider's session?

F-01 identifies the missing session invalidation. The question is whether this should be a hard requirement (always invalidate) or a soft one (let sessions expire naturally). Given that the IPA-to-local path changes the user's entire auth capability (no more IPA operations, possibly different expiry), invalidation seems appropriate.

### Q3 — Local group membership for IPA users — intended or tolerated?

Local groups can contain IPA users (`local-groups.ts:addMember` does not check user provider). This is presumably intentional (local groups are cross-provider), but it means that when an IPA user is demoted or deleted, their local group memberships need to be considered. The sync junction table rebuild only deletes IPA-provider junction rows, so local memberships survive. This appears correct.

### Q4 — Will the legacy `ipa/users.ts` facade be retired?

The `ipa/index.ts` facade mixes references to `accounts.*`, `providers.*`, and local legacy imports. Some functions (like `setExpiry`, `deleteUser`, `addGuest`) are still imported from the legacy `./users.ts`. The migration doc lists this as a cleanup target. Until retirement, the dual-path risk persists (F-03, F-06).

---

## 5. KISS Assessment

### Where KISS is upheld

1. **Model layer** (`accounts/model.ts`, `authz.ts`, `switching.ts`) — These are small, focused, and readable. The realm↔provider/profile mapping is clean.

2. **Provider dispatch** (`accounts/users.ts`, `accounts/groups.ts`) — Explicit if/else branching by provider. No abstract factory, no generic provider interface. Simple dispatch.

3. **Lifecycle** (`account-lifecycle/index.ts`) — Straightforward imperative code with clear separation between IPA demotion, guest cleanup, backfill, and reminders.

4. **Magic link flow** (`auth-flows/magic-link.ts`) — Simple and correct. Token creation via Redis GETDEL is a clean one-time consumption pattern.

5. **Local groups** (`local-groups.ts`) — Self-contained, provider-scoped, no unnecessary abstraction.

### Where complexity is higher than necessary

1. **Legacy IPA module is still the real runtime owner for key operations.** The `providers/ipa/*` modules are thin re-export wrappers over `ipa/*`. The actual logic (1199 lines in `ipa/users.ts`, 605 in `ipa/groups.ts`) lives in the legacy module. This means the "new" provider layer is a routing facade, not a true modular replacement. Until the logic is actually moved, the `providers/` directory gives a false sense of encapsulation.

2. **Two guest creation paths** (F-06). The legacy `addGuest` and the new `createGuest` both exist and are both called from different entry points.

3. **Dual expiry writes.** Every mutation that changes `account_expires` also computes and writes `ipa_account_expires` and `guest_expires_at`. This is repetitive and adds 3-5 lines to every expiry mutation. Justified for migration safety, but should be removed once the transition is complete.

4. **`me.ts` bypasses the unified dispatch layer** (F-03). The self-service profile update calls the legacy module directly, creating an inconsistency with the admin update path.

5. **Realm translation in `list`** (`accounts/users.ts:124-150`). The `list` function maps `provider/profile` filters to `realm[]` arrays and delegates to `legacyUsers.list`. This translation layer exists only because the underlying SQL query still filters by `realm`. Once `realm` is deprecated, this can be simplified.

### Overall KISS verdict

The implementation is **acceptably complex** given the migration constraints. The code is generally explicit, boring, and correct — which is what matters. The main KISS concern is the incomplete decoupling from the legacy IPA module: the `providers/ipa/` layer is aspirational rather than structural, and the real logic still lives in `ipa/users.ts` and `ipa/groups.ts`. This should be addressed in the planned cleanup pass.

---

## 6. Overall Verdict

**The unified account backend is sound.** It correctly implements the intended model:

- One canonical user (`provider + profile + accountExpires`) with stable UUID identity across provider switches.
- One canonical group (`provider`) with correct cross-provider membership rules enforced at both the DB and application level.
- FreeIPA-first mutation ordering consistently applied across all IPA operations.
- Session isolation: acting user sessions for admin mutations, service sessions only for sync/lifecycle.
- Provider switching preserves local relations correctly (IPA relations cleared, local preserved).
- Canonical `account_expires` is the runtime source of truth for lifecycle decisions.
- Safety guards in sync (empty-list protection, stale-count thresholds).

**No critical or high-severity findings.** The medium findings (F-01 through F-03) are real issues that should be addressed but do not represent immediate data loss or security risks. The low findings are inconsistencies and cleanup opportunities.

### Recommended actions (priority order)

1. **Add `session.deleteAllForUser` to `switchProvider` to-local path** (F-01)
2. **Make admin `demoteToGuest` atomic** — either reuse the lifecycle helper or wrap both mutations in a transaction (F-02)
3. **Route `me.ts` PATCH through `accounts.users.update`** instead of `providers.ipa.users.update` (F-03)
4. **Align sync stale-demotion expiry with canonical setting key** (F-04)
5. **Plan the legacy IPA module retirement** to eliminate the dual-path risk (F-03, F-06, KISS concerns)
