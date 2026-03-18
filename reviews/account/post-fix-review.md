# Account Backend Post-Fix Review

Full re-review of the account backend after the implementation pass.

---

## 1. What Was Fixed (Confirmed Resolved)

### Security

| Original ID | Title | Status |
|---|---|---|
| AS-01 | Email enumeration via `requiresPassword` in magic-link flow | **Resolved.** `magic-link.ts:request()` now returns `void`. `auth.ts:/email-login` always returns a neutral 200: _"If this email can use login codes, a code has been sent."_ `GuestLoginForm.island.tsx` shows a matching neutral message. |
| AU-01 | No self-action prevention on destructive admin actions | **Resolved.** `users.ts:preventSelfDestructiveAction` (lines 72-79) blocks self-target on: reset-password, switch-provider, create-ipa, make-local, delete/demote, set-profile-to-guest. |
| AG-01 | API layer missing explicit authorization for IPA group mutations | **Resolved.** `groups.ts` now uses `requireAdminIpaSession` (service session for admins, lines 57-65) vs `requireActorIpaSession` (personal IPA session for non-admins, lines 48-55). IPA groups get admin-session when the actor is admin, personal-session otherwise. FreeIPA remains the final write authority. |

### Correctness

| Original ID | Title | Status |
|---|---|---|
| Flow 23 | No lifecycle handler for expired local full users | **Resolved.** `lifecycle/index.ts:cleanupExpiredLocalUsers()` (lines 362-418) deletes expired `local/user` accounts with full audit trail. `scheduler.ts` registers `localUserCleanupJob`. Backfill and reminder coverage also added. |
| IG-05 | `syncUser()` doesn't update `last_login_ipa` | **Resolved.** `sync.ts:syncUser()` now writes `last_login_ipa` in its UPDATE (line 584). |

### Structure / DRY

| Original ID | Title | Status |
|---|---|---|
| S-05 | Recursive group CTE duplicated 9+ times | **Resolved.** `group-sql.ts` (new, 106 lines) extracts reusable CTE builders (`recursiveUserGroupsSubquery`, etc.). Used in `users.ts` and `groups.ts`. |
| S-06 | `buildBaseUser` existed in two files with different logic | **Resolved.** `base-user.ts` (new, 36 lines) provides a single shared `buildBaseUser` + `resolveProviderProfile`. |
| S-01 | `providers/ipa/` re-export layer served no purpose | **Resolved.** The directory is empty. `providers/index.ts` imports directly from `../ipa/*`. |
| S-14 | `get()` too expensive for existence checks | **Resolved.** `getMinimal()` added as a lightweight alternative for mutation guards. |
| S-15 | Triple group fetch in mutation paths | **Partially resolved.** `requireGroupMutationContext` now fetches the group once (line 69) and passes it through. `requireLocalGroupManageAccess` still does a second fetch (line 32). Down from 3 to 2 fetches. |

---

## 2. Remaining Open Items

### P1 — Should fix

#### R-01 | medium | `me.ts` uses raw `c.json()` instead of `respond()` for 3 of 5 endpoints

**Impact:** Inconsistent error response shapes. Internal error messages may leak to the client.

`/password` (line ~93-116), `/ssh-keys` (line ~134-158), and `DELETE /` (line ~174-205) in `api/me.ts` forward `result.error` directly to the client via `c.json({ message: result.error }, result.status)` instead of using `respond()`. If the underlying provider returns verbose internal error messages, they reach the client unfiltered. The first two endpoints (`/extend-account`, `PATCH /`) correctly use `respond()`.

**Files:** `packages/apps/src/accounts/api/me.ts`

---

#### R-02 | medium | `ChangeExpiredPasswordSchema` in core allows 1-char passwords while `apps` version requires 8

**Impact:** Expired-password changes via `/auth/change-password` (in `core/api/auth.ts`) enforce only `min(1)`, while regular changes via `/api/accounts/me/password` enforce `min(8)`. An attacker who triggers a password expiry could set a weaker password through the expired-password flow.

**Files:** `packages/core/src/api/me/schemas.ts:18` (`min(1)`), `packages/apps/src/accounts/api/me/schemas.ts:20` (`min(8)`)

---

#### R-03 | medium | Double group fetch still exists in `requireGroupMutationContext` → `requireLocalGroupManageAccess`

**Impact:** Performance — two DB queries for the same group per mutation.

`requireGroupMutationContext` (line 69) fetches the group. Then `requireLocalGroupManageAccess` (line 32) fetches the same group again via `accountsService.group.get`. The already-fetched group from line 69 should be passed to the access check.

**Files:** `packages/apps/src/accounts/api/groups.ts:32, 69`

---

#### R-04 | low | `set-expiry` route has no self-action prevention

**Impact:** An admin could set their own `account_expires` to a past date, effectively locking themselves out.

`preventSelfDestructiveAction` is applied to delete, demote, switch-provider, and reset-password — but not to `set-expiry` (lines 380-418 of `users.ts`). Setting expiry to the past is a destructive self-action.

**Files:** `packages/apps/src/accounts/api/users.ts:380-418`

---

#### R-05 | low | `set-expiry` accepts free-form string, not validated as date

**Impact:** Invalid date strings reach the service layer as `NaN`.

The inline schema at users.ts line 397 validates `expiryDate` as `z.string().nullable()` without checking it is a valid ISO date. `normalizeManualAccountExpiry` (users.ts:53) handles `NaN` by returning `null`, which silently removes the expiry instead of reporting an error.

**Files:** `packages/apps/src/accounts/api/users.ts:397`

---

### P2 — Worth addressing

#### R-06 | low | `switchProvider` still double-fetches the same user

**Impact:** Minor performance — `getUserRow()` and `getMinimal()` both query `auth.users` by the same ID.

`users.ts:528-531` calls both `getUserRow(params.id)` and `getMinimal({ id: params.id })`. The only field from `row` not available in `getMinimal` is the raw row needed by `resolveAccountExpires()`. Since `getMinimal` already returns `accountExpires`, the `getUserRow` call is redundant.

**Files:** `packages/core/src/services/accounts/users.ts:528-531`

---

#### R-07 | low | In-memory pagination of full group membership lists

**Impact:** Performance at scale — all members/managers/parents are fetched from the DB, then paginated in JS.

`app.ts:paginateItems()` (line 93) fetches the entire list then slices. Used for `user.group.list`, `user.managedGroup.list`, `group.member.list`, `group.manager.list`, `group.parent.list`. For organizations with hundreds of group memberships, this loads everything into memory per page request.

**Files:** `packages/core/src/services/accounts/app.ts:93-113`

---

#### R-08 | low | N+1 INSERT patterns in IPA sync junction table rebuild

**Impact:** Performance for large FreeIPA deployments.

`sync.ts:445-478` inserts each user-group, group-group, manager-user, and manager-group relationship one at a time in nested loops. For large organizations with thousands of relationships, batch INSERTs would be significantly faster.

**Files:** `packages/core/src/services/ipa/sync.ts:445-478`

---

#### R-09 | low | N+1 profile update after group hierarchy changes

**Impact:** Performance — after a group membership change, each affected user's profile is recalculated individually.

`profile.ts:updateProfileForAffectedUsers()` (lines 68-85) loops affected users calling `updateUserIpaProfile()` one at a time. `groups.ts:removeMember()` (lines 508-524) does the same. Each call runs a recursive CTE + UPDATE.

**Files:** `packages/core/src/services/ipa/profile.ts:68-85`

---

#### R-10 | low | Two different LIKE escape functions used

**Impact:** Consistency — `freeipa.util.escapeLike` in `users.ts:215` and `groups.ts:44`, vs `escapeLikePattern` from `postgres.ts` in `local-groups.ts:108`. Both are correct but the FreeIPA utility shouldn't be the standard for non-IPA modules.

**Files:** `packages/core/src/services/accounts/users.ts:215`, `local-groups.ts:108`

---

#### R-11 | low | Account request SQL still repeated 4 times in `app.ts`

**Impact:** DRY — four nearly identical SQL blocks for listing account requests by status.

`app.ts` (around lines 496-603) has four almost identical query blocks for pending/completed/denied/all that differ only in the WHERE clause.

**Files:** `packages/core/src/services/accounts/app.ts`

---

#### R-12 | low | Empty `providers/ipa/` directory still on disk

**Impact:** Confusing artifact — the directory exists but is empty after the re-export removal.

**Files:** `packages/core/src/services/providers/ipa/`

---

### P3 — Informational / accepted tradeoffs

#### R-13 | info | FreeIPA-first deletion creates a consistency window

All IPA deletion/demotion paths (`demoteExpiredIpaUsers`, `demoteToGuest`, `deleteUser`, `switchProvider`) delete from FreeIPA before the local DB transaction. If the DB transaction fails after FreeIPA deletion, the user is gone from IPA but still shows as `provider: "ipa"` locally. The next sync detects this as a stale user and reconciles. This is an accepted tradeoff — reversing the order would risk a worse split-brain (user deleted locally but still in IPA).

---

#### R-14 | info | `buildBaseUser` roles always lack admin/group-manager

`base-user.ts:buildBaseUser()` always passes `memberofGroup: []` and `manages: []` to `buildRoles`. This means `BaseUser.roles` in list views never includes `admin` or `group-manager`. This is a design choice (list endpoints return minimal data), not a security issue (authorization uses `SessionUser`). But UI code should not rely on `BaseUser.roles` being authoritative.

---

#### R-15 | info | Session revocation is best-effort everywhere

All deletion/demotion paths wrap `session.deleteAllForUser()` in try/catch. If Redis is down, deleted users retain valid sessions until natural expiry. On the next request, `accounts.users.get()` would fail to find them, effectively logging them out. Acceptable tradeoff.

---

#### R-16 | info | Timing side-channel in magic-link request

`magic-link.ts:request()` returns faster for IPA-user emails (no email sent) than for local/new users (email sent). Both return the same neutral 200 response, but the response time differs. This is a very minor information leak — an attacker with precise timing could distinguish IPA accounts. Mitigating this would require adding a delay or background queuing of the email send.

---

#### R-17 | info | `compat.ts` dual-write to legacy columns persists

All write paths still maintain `realm`, `ipa_account_expires`, `guest_expires_at` alongside canonical `provider`, `profile`, `account_expires`. This is necessary for the transition period. Once legacy columns are dropped, `compat.ts` and all `legacyAccountColumnsFromCanonical` calls become dead code.

---

## 3. Verdict

The implementation pass addressed all the highest-priority findings from the original review:

- **Email enumeration** is fixed end-to-end (backend + UI).
- **Self-action prevention** is correctly implemented for all destructive admin actions (with the minor gap of `set-expiry`).
- **IPA group authorization** now has a clean layered model (admin service session vs personal IPA session).
- **Local user expiry lifecycle** is fully implemented with cleanup, backfill, reminders, and audit.
- **Structural cleanup** (shared CTE builders, unified BaseUser, removed dead re-export layer, `getMinimal()`) meaningfully reduces complexity.

What remains is primarily polish:

- `me.ts` response consistency (R-01)
- Password schema mismatch (R-02)
- One remaining double-fetch in group mutations (R-03)
- Performance patterns (in-memory pagination, N+1 sync inserts) that only matter at scale (R-07/R-08/R-09)
- Minor DRY items (LIKE escaping, account request SQL)

The system is functionally coherent, the security posture is solid, and the canonical `(provider, profile)` model is implemented correctly across all layers.
