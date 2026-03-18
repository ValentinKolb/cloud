# IPA / User / Account Lifecycle — Code Review

**Date:** 2026-03-06
**Scope:** Backend + frontend changes for FreeIPA users, guest users, account expiry, lifecycle reminders, deleted-account audit, IPA sync/demotion/cleanup jobs, and admin UI.

---

## 1. Executive Summary

The lifecycle refactor is well-structured overall. Audit writes are consistently transactional alongside destructive state changes, session revocation is correctly best-effort, and the three semantic concepts (runtime logs, deleted-account audit, reminder history) are cleanly separated in both the schema and the UI.

Key issues found:

- **Critical:** The IPA sync (`syncFromIpa`) does not demote or clean up locally-cached IPA users that disappear from FreeIPA between syncs (stale IPA users remain as "ipa"/"ipa-limited" indefinitely).
- **High:** The `demoteExpiredIpaUsers` flow deletes from FreeIPA *before* writing the local transaction — if the DB transaction fails, the IPA user is already gone but the local user is still "ipa", creating an inconsistent state.
- **High:** The unique index on `account_lifecycle_reminders` uses `user_id` which becomes NULL on user deletion, breaking deduplication for reminders of deleted users.
- **Medium:** Several race-window and partial-failure edge cases in the lifecycle jobs.
- **Low:** Minor frontend labeling inconsistencies and missing auth guards.

---

## 2. Findings (ordered by severity)

### Critical

1. **Stale IPA users never cleaned up from local DB** — see Backend Finding B1
2. **Reminder dedup index breaks after user deletion** — see Backend Finding B5

### High

3. **IPA delete-before-DB-commit ordering risk in `demoteExpiredIpaUsers`** — see Durability Finding D1
4. **`generateAbbreviation` modulo bias** — see Backend Finding B7

### Medium

5. **Legacy setting fallback in `calculateAccountExpiration`** — see Consistency Finding C1
6. **`syncFromIpa` doesn't handle expired users during sync** — see Backend Finding B2
7. **`listReminderCandidates` runs two sequential queries instead of one** — see Simplification S1
8. **Settings SettingsForm helper text references "lifecycle audit schedule" but no setting key is shown** — see Frontend Finding F3

### Low

9. **Sidebar landing page requires "ipa" role, not "authenticated"** — see Security Finding Sec1
10. **Filter chips use full-page navigation** — see Frontend Finding F4

---

## 3. Backend Findings

### B1: Stale IPA users never cleaned up (Critical)

**File:** `packages/core/src/services/ipa/sync.ts:209`
**Lines:** 209–344

The `syncFromIpa` function upserts active IPA users but never removes or demotes local users whose UIDs no longer appear in the FreeIPA response. If a user is removed from all `GROUPS_BASE_SYNC` groups in IPA (or deleted from IPA entirely), they remain in the local DB with `realm = 'ipa'` or `'ipa-limited'` forever.

The only cleanup path is `demoteExpiredIpaUsers`, which only runs when `ipa_account_expires <= now()`. A user removed from IPA with a far-future expiry (or no expiry) will never be cleaned up.

**Why it matters:** Orphaned IPA users retain their roles and group memberships locally, creating a privilege persistence risk.

**Recommendation:** After upserting active users, compare the set of UIDs received from IPA against the set of locally-stored `realm IN ('ipa', 'ipa-limited')` users. Any local user not in the IPA set should be either flagged, demoted to guest, or marked `synced_at = NULL` for manual review. Use a safety threshold (e.g., don't demote more than 20% of users in a single sync to guard against IPA API issues).

---

### B2: Expired users are filtered out during sync but not demoted

**File:** `packages/core/src/services/ipa/sync.ts:209`
**Line:** 209

```ts
const activeUsers = users.filter((u) => !isExpired(u));
```

Expired users are silently skipped during sync. Their local records are not updated (no `synced_at` bump) and they're not demoted. The demotion only happens in a separate `demoteExpiredIpaUsers` step within the same job. This is acceptable *only* if the sync job always runs both steps atomically.

**File:** `packages/core/src/services/account-lifecycle/scheduler.ts:83–107`

The `ipaSyncJob` does run both steps sequentially. However, if the `demote-expired` step throws, the sync was already committed but demotions were not. The job retries, but on retry, `syncFromIpa` runs again (re-syncing everything), then `demote-expired` runs again. This is idempotent and safe but wastes effort.

**Severity:** Medium
**Recommendation:** Consider having the sync step itself mark expired users (e.g., set a flag or log them) so the demotion step can operate on a known set rather than re-querying.

---

### B3: `deleteUser` writes audit then deletes in same transaction — correct

**File:** `packages/core/src/services/ipa/users.ts:1000–1017`

```ts
await sql.begin(async (tx) => {
    await writeDeletedAccountAudit({ db: tx, ... });
    await tx`DELETE FROM auth.users WHERE id = ${id}`;
});
```

This is correct: audit is written in the same transaction as the delete, ensuring atomicity. If audit insert fails, the delete doesn't happen.

**Status:** No issue — confirming this is correct.

---

### B4: `demoteToGuest` correctly writes audit in same transaction

**File:** `packages/core/src/services/ipa/users.ts:907–937`

The manual demote path correctly uses `sql.begin` to wrap the user update, group cleanup, and audit write in a single transaction. FreeIPA delete is done *before* the transaction, which is acceptable because the IPA delete is tolerant of "not found" (line 898–899).

**Status:** No issue — confirming this is correct.

---

### B5: Reminder dedup unique index breaks on user deletion (Critical)

**File:** `packages/core/src/migrate/core/auth.ts:493–495`

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_lifecycle_reminders_target
ON auth.account_lifecycle_reminders(user_id, kind, threshold_days, target_expiry_at)
```

**File:** `packages/core/src/migrate/core/auth.ts:442`

```sql
user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
```

When a user is deleted, `user_id` is set to NULL. PostgreSQL unique indexes treat NULL as distinct, so multiple reminders with `user_id = NULL` and the same `(kind, threshold_days, target_expiry_at)` will all be considered unique. This means:

1. If a user is deleted and a new user gets the same expiry date, the dedup check in `upsertReminderAttempt` (which uses `ON CONFLICT (user_id, kind, threshold_days, target_expiry_at)`) will not match the old NULL row — this is fine for dedup.
2. However, the index no longer prevents duplicate NULL rows from accumulating over time from historical data.

More importantly, the `ON CONFLICT` clause in `upsertReminderAttempt` (line 81) will fail for users with `user_id = NULL` because the unique index can't match on NULL.

**Why it matters:** After enough user deletions, the `account_lifecycle_reminders` table will accumulate orphaned rows that can never be upserted again. The `cleanupLifecycleAudit` function handles this by deleting old rows, but the dedup guarantee is broken for the retention window.

**Recommendation:** Either:
- Use `COALESCE(user_id, '00000000-0000-0000-0000-000000000000')` in the unique index, or
- Change `ON DELETE SET NULL` to `ON DELETE CASCADE` since reminder history rows for deleted users are already self-contained (they store `uid`, `mail`, `display_name` directly). The current design stores denormalized data specifically to survive user deletion, but then uses `SET NULL` which creates a different class of problem.

Actually, `ON DELETE CASCADE` might be inappropriate if you want to preserve reminder history after user deletion. The better fix is to keep `SET NULL` but add a partial unique index that only applies when `user_id IS NOT NULL`:

```sql
CREATE UNIQUE INDEX ... ON auth.account_lifecycle_reminders(user_id, kind, threshold_days, target_expiry_at)
WHERE user_id IS NOT NULL;
```

---

### B6: `redis.keys` used for session deletion

**File:** `packages/core/src/services/session/index.ts:84`

```ts
const keys = await redis.keys(`session:${userId}:*`);
```

`KEYS` is an O(N) command that blocks Redis. For production systems with many sessions, this should use `SCAN` instead. However, given that sessions are scoped per user (few keys per user), this is acceptable at current scale.

**Severity:** Low
**Recommendation:** Document this as a known limitation. If session volume grows, switch to `SCAN` or maintain a per-user session set.

---

### B7: `generateAbbreviation` has modulo bias

**File:** `packages/core/src/services/ipa/users.ts:398–403`

```ts
const chars = "abcdefghijklmnopqrstuvwxyz";
const bytes = new Uint8Array(length);
crypto.getRandomValues(bytes);
return Array.from(bytes, (b) => chars[b % chars.length]).join("");
```

`256 % 26 = 22`, so the first 22 characters have a slightly higher probability. For a 5-character UID, this creates a measurable bias.

**Severity:** High (for UID uniqueness at scale, though acceptable at small scale)
**Recommendation:** Use rejection sampling: `while ((b = bytes[i]) >= 234) regenerate`. Or switch to `crypto.randomInt(26)`.

---

### B8: `auth.ts` verify-token creates guest user inline instead of using `addGuest`

**File:** `packages/core/src/api/auth.ts:268–279`

The magic-link token verification creates a guest user with a raw SQL INSERT instead of using `ipa.users.addGuest()`. This duplicates the guest creation logic and could diverge over time (e.g., `addGuest` might gain additional initialization steps that the inline INSERT misses).

**Severity:** Medium
**Recommendation:** Use `ipa.users.addGuest()` here.

---

## 4. Frontend Findings

### F1: Labels and navigation are consistent and accurate

**File:** `packages/apps/src/accounts/frontend/AccountsNavSidebar.tsx:38–49`

The sidebar correctly labels:
- "Deleted Accounts" (for `auth.deleted_accounts`) — accurate
- "Reminder History" (for `auth.account_lifecycle_reminders`) — accurate
- "Dashboard" — accurate

These do not blur with runtime logs. The dashboard shows "Recent Activity" which pulls from `logging.entries` with lifecycle-specific source filters, and the quick links correctly navigate to the logs page with source filters.

**Status:** No issue.

---

### F2: AdminOperations descriptions are accurate and helpful

**File:** `packages/apps/src/accounts/frontend/dashboard/AdminOperations.island.tsx:19–68`

The operation descriptions accurately match backend behavior:
- "Force Sync" mentions users/groups/hosts sync and expired IPA demotion — matches `ipaSyncJob` which runs both `syncFromIpa()` and `demoteExpiredIpaUsers()`.
- "Force IPA Backfill" correctly explains the "never set earlier than now plus 7 days" behavior — matches `runIpaBackfill` which uses `Math.max(configuredDays, 7)`.
- "Force Reminder Run" correctly mentions deduplication semantics.

**Status:** No issue.

---

### F3: Settings helper text mentions "lifecycle audit schedule" which is unclear

**File:** `packages/apps/src/settings/frontend/SettingsForm.island.tsx:191`

```tsx
Cleanup runs on the lifecycle audit schedule.
```

This refers to the `app.cleanup_schedule` cron, but the text says "lifecycle audit schedule" which could be confusing. A non-technical admin might not know what "lifecycle audit schedule" means or where to find it.

**Severity:** Medium
**Recommendation:** Change to "Cleanup runs on the app cleanup schedule (`app.cleanup_schedule`)." or simply "Old entries are automatically cleaned up on a daily schedule."

---

### F4: Filter changes cause full page navigation

**Files:**
- `packages/apps/src/accounts/frontend/deleted-accounts/DeletedAccountsFilters.island.tsx:31`
- `packages/apps/src/accounts/frontend/reminders/ReminderFilters.island.tsx:42`

Both use `window.location.href = buildUrl(...)` which causes a full page reload on every filter change. This is a UX choice (SSR-first) and consistent with the rest of the app.

**Severity:** Low
**Status:** Acceptable for SSR-first architecture.

---

### F5: Deleted accounts page correctly shows "Details" for meta

**File:** `packages/apps/src/accounts/frontend/deleted-accounts/page.tsx:109–114`

The `<details>` element for meta is appropriate — it shows additional audit metadata (actor info, flags) on demand without cluttering the table. The meta JSON is rendered as-is, which is fine for admin audiences.

**Status:** No issue.

---

### F6: Reminder history page shows `entry.userId` as fallback display name

**File:** `packages/apps/src/accounts/frontend/reminders/page.tsx:97`

```tsx
<span class="text-primary">{entry.displayName || entry.uid || entry.userId}</span>
```

If both `displayName` and `uid` are null (which can happen after user deletion if the denormalized columns were not populated), the raw UUID (`userId`) is shown. This would be confusing to admins.

**Severity:** Low
**Recommendation:** Show "(deleted user)" or "(unknown)" instead of a raw UUID.

---

### F7: Accounts landing page guard requires "ipa" role

**File:** `packages/apps/src/accounts/pages.ts:14`

```ts
.get("/", auth.requireRole("ipa", auth.redirectToLogin), ...landingPage)
```

Guest users cannot access the accounts landing page at all. The page itself (in `page.tsx:32`) has a non-admin fallback that shows "View your profile and manage your groups" — but guests can't reach it because the route guard requires "ipa" (which means `ipa` or `ipa-limited` but not `guest`).

**Severity:** Low (depends on whether guests should have access to the accounts app at all)
**Recommendation:** If guests should see their profile link, change to `auth.requireRole("authenticated", ...)`. If not, this is intentional and fine.

---

## 5. Consistency / Naming Issues

### C1: Legacy setting fallback in `calculateAccountExpiration`

**File:** `packages/core/src/services/ipa/users.ts:454–466`

```ts
const expiresDays = await settings.get<number | null>("user.account.ipa_expires_days");
const legacyExpiresDays = await settings.get<number | null>("user.account.expires_days");
const days = expiresDays ?? legacyExpiresDays;
```

This function still falls back to the legacy `user.account.expires_days` key. The same pattern appears in `getIpaExpiresDays` in `account-lifecycle/index.ts:46–49`. These should be unified.

**Severity:** Medium
**Recommendation:** Since `user.account.ipa_expires_days` is the canonical key (registered in `defaults.ts`), the legacy fallback should be removed after a migration period. Or add a migration that copies the legacy value to the new key and drops the old one.

---

### C2: `deprecated` export `add` in users.ts

**File:** `packages/core/src/services/ipa/users.ts:606–615`

The `@deprecated` `add` function wraps `addIpa` but with a different return type shape. It's not re-exported from `index.ts`, so it may be dead code.

**Severity:** Low
**Recommendation:** Check for remaining callers and remove if unused.

---

### C3: `toPgTextArray` is duplicated

**Files:**
- `packages/core/src/services/ipa/lib.ts:168`
- `packages/core/src/services/logging/index.ts:72`

Two identical implementations of `toPgTextArray`.

**Severity:** Low
**Recommendation:** The logging module already imports from `services/index.ts` which re-exports `toPgTextArray` from `ipa/lib`. The logging module should use that instead of its own copy.

---

## 6. Dead Code / Duplicate Logic

### DC1: `add` (deprecated wrapper) in users.ts

**File:** `packages/core/src/services/ipa/users.ts:606–615`

Not exported from `index.ts`. Likely dead code.

---

### DC2: `type AddUserResult = AddIpaResult`

**File:** `packages/core/src/services/ipa/users.ts:1035`

Unused type alias at the end of the file.

---

## 7. Durability / Partial-Failure Risks

### D1: IPA delete before DB transaction in `demoteExpiredIpaUsers`

**File:** `packages/core/src/services/account-lifecycle/index.ts:240–263`

```ts
const ipaDelete = await deleteFromFreeIpa(ipaSession, uid);
// ... error check ...
await sql.begin(async (tx) => {
    await demoteUserToGuest({ id: userId, guestExpiresAt, db: tx });
    await writeDeletedAccountAudit({ db: tx, ... });
});
```

The FreeIPA user is deleted *before* the local DB transaction. If the DB transaction fails (e.g., deadlock, connection drop), the IPA user is permanently deleted but the local user remains as `realm = 'ipa'`. On the next sync, the orphaned local user won't be cleaned up (see B1), and on the next `demoteExpiredIpaUsers` run, the `deleteFromFreeIpa` call will return "not found" (which is tolerated), and the DB transaction will be retried. So this is self-healing on retry.

**Severity:** High (temporary inconsistency, self-healing on retry)
**Recommendation:** This ordering is acceptable given the "not found is ok" tolerance, but document the invariant. Alternatively, do the IPA delete inside the DB transaction's post-commit hook if your framework supports it.

---

### D2: Best-effort session revocation is correctly implemented

**Files:**
- `packages/core/src/services/ipa/users.ts:938–946` (manual demote)
- `packages/core/src/services/ipa/users.ts:1018–1026` (manual delete)
- `packages/core/src/services/account-lifecycle/index.ts:263–271` (auto demote)
- `packages/core/src/services/account-lifecycle/index.ts:319–327` (auto cleanup)

All four paths correctly wrap `session.deleteAllForUser` in try/catch and log warnings on failure without surfacing it as an action failure. This matches the intended semantics.

**Status:** Correct.

---

### D3: Guest cleanup deletes user inside transaction with audit — correct

**File:** `packages/core/src/services/account-lifecycle/index.ts:306–318`

```ts
await sql.begin(async (tx) => {
    await writeDeletedAccountAudit({ db: tx, ... });
    await tx`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
});
```

Audit is written before the delete in the same transaction. If audit fails, user is not deleted. If delete fails, audit is rolled back. Correct.

---

## 8. Security / Auth Risks

### Sec1: Accounts page guard — "ipa" vs "authenticated"

**File:** `packages/apps/src/accounts/pages.ts:14`

See F7 above. The landing page requires "ipa" role. If this is intentional (guests should not access the accounts app), this is fine. If not, it's a minor access control issue.

---

### Sec2: Admin lifecycle API correctly requires "admin" role

**File:** `packages/core/src/api/admin-account-lifecycle.ts:69`

```ts
.use(auth.requireRole("admin"))
```

All admin lifecycle endpoints (deleted accounts, reminders, job triggers) are correctly protected behind the admin role. The pages in `pages.ts` also require admin for these routes (lines 19–20).

**Status:** Correct.

---

### Sec3: Self-delete correctly limited to guests

**File:** `packages/core/src/api/me.ts:187–189`

```ts
if (!hasRole(user, "guest")) {
    return c.json({ message: "Only guest accounts can be self-deleted." }, 403);
}
```

IPA users cannot self-delete. Self-delete for guests correctly writes audit (via `ipa.users.delete`) and destroys the session.

**Status:** Correct.

---

### Sec4: Account extension has no rate limiting beyond global

**File:** `packages/core/src/api/me.ts:32–53`

The `/extend-account` endpoint uses the global rate limiter but has no per-user rate limiting. A user could repeatedly extend their account. However, since extension always sets expiry to `now + configuredDays`, repeated calls are idempotent (they just push the expiry to the same future date). Not a real security issue.

**Status:** Acceptable.

---

## 9. Suggested Simplifications (KISS / DRY)

### S1: Combine IPA and guest reminder candidate queries

**File:** `packages/core/src/services/account-lifecycle/index.ts:166–212`

`listReminderCandidates` runs two separate queries (IPA + guest), then merges them in JS. These could be combined into a single SQL query with a CASE expression for `kind` and a UNION, reducing round-trips.

**Severity:** Low
**Recommendation:** Combine into one query for simplicity and performance.

---

### S2: Guest user creation logic duplicated in auth.ts

**File:** `packages/core/src/api/auth.ts:268–279`

See B8 above. The inline guest creation in the magic-link flow duplicates logic from `addGuest`.

---

### S3: Dashboard summary is a single SQL query — good

**File:** `packages/apps/src/accounts/service/admin.ts:62–106`

The dashboard uses a single SQL query with subqueries for all counts. This is SQL-first and avoids N+1 or JS-side aggregation. Well done.

---

## 10. Open Questions

1. **Stale user cleanup policy:** What should happen to local IPA users that no longer exist in FreeIPA? Should they be auto-demoted to guest, flagged for review, or left as-is? This is the most significant gap in the current lifecycle logic (see B1).

2. **Legacy `user.account.expires_days` migration:** Is there a plan to migrate existing installations from the legacy key to `user.account.ipa_expires_days`? Or should the fallback be kept indefinitely?

3. **Guest self-delete audit actor:** When a guest self-deletes, the actor is the user themselves (`actor: { userId: user.id, uid: user.uid }`). Is this intentional and clear in audit reports? The meta will show `actorUserId` = `deletedUserId`, which is accurate but might look odd to auditors.

4. **Reminder retention vs audit retention:** Both have separate retention settings (`reminder_history_retention_days` and `deleted_accounts_retention_days`). Should there be a minimum floor (e.g., 30 days) to prevent accidental data loss if an admin sets it to 0? Currently, 0 means "keep forever" which is safe, but a small positive value (like 1) could cause premature cleanup.

5. **Backfill minimum of 7 days:** Both `runIpaBackfill` and `runGuestBackfill` use `Math.max(configuredDays, 7)`. The guest backfill description in AdminOperations says "never set earlier than now plus 7 days" which is accurate. But should this floor be configurable or at least documented in the settings description?
