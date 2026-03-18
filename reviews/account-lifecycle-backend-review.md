# Account Lifecycle Backend Review

## Executive Summary

The account lifecycle refactor introduces a well-structured system for managing IPA and guest account expiry, demotion, cleanup, and reminder notifications. The scheduler integration via `@valentinkolb/sync` is clean, and the migration is properly additive/idempotent. However, several issues were found:

- **2 Critical bugs**: A race condition between IPA sync and lifecycle demotion that can cause double-demotion with data loss, and a SQL injection vector via unescaped LIKE patterns in search queries.
- **3 High-severity issues**: Missing `guest_expires_at` assignment on demote in `ipa/users.ts`, a scheduler registration race on module-level `registered` flag, and notification send-status checking that may produce false negatives.
- **Several medium/low issues**: Duplicated `toGeneralizedTime`, inconsistent logger naming, missing rate limiting on the extend-account endpoint, and dead code.

Overall the refactor is solid but needs targeted fixes before production.

---

## Findings (Ordered by Severity)

### 1. Race: IPA sync demotion + lifecycle demotion can double-process users

**Severity**: Critical
**File**: `packages/core/src/services/ipa/sync.ts:329-354` and `packages/core/src/services/account-lifecycle/index.ts:239-297`
**Status**: New

**Problem**: The `ipaSyncJob` in `scheduler.ts:44-49` runs `syncFromIpa()` then immediately runs `accountLifecycle.demoteExpiredIpaUsers()`. However, `syncFromIpa()` at line 329-354 *already* demotes IPA users not in the active set to guest (setting `realm = 'guest'`). Then `demoteExpiredIpaUsers()` queries for `realm IN ('ipa', 'ipa-limited')` — so it should find nothing. But there's a subtle issue:

The `syncFromIpa` transaction demotes users **within the transaction**, and on line 353, deletes their `user_groups` and `group_manager_users`. This operates on **all** guests (not just newly-demoted ones), which means that if any previously-demoted guest still existed, their junction rows get re-deleted.

More critically, the demotion in `sync.ts:331-351` sets `guest_expires_at` from a freshly-computed value, while the lifecycle `demoteUserToGuest` also computes its own `guestExpiresAt`. If the sync and the lifecycle job run out of order (e.g., manual trigger of demotion before sync finishes), the `guest_expires_at` could be set twice with different values.

**Fix**: Consider removing the demotion logic from `demoteExpiredIpaUsers` entirely, since the IPA sync job already handles demotion of expired users. Alternatively, make `demoteExpiredIpaUsers` skip users that are already `realm = 'guest'` (it does filter by `realm IN ('ipa', 'ipa-limited')` so this should be safe in practice). The real concern is the double FreeIPA delete call — `demoteExpiredIpaUsers` calls `deleteFromFreeIpa` for users that `syncFromIpa` already considers "not active". If a user's `ipa_account_expires` passed but they're still in IPA (just expired), both paths will try to process them. Make sure `deleteFromFreeIpa`'s not-found handling (line 176-177) prevents errors, which it does. Downgrade risk: the primary concern is the **`session.deleteAllForUser`** call in lifecycle (line 284) happening for a user whose session was already invalidated — this is idempotent. In practice this is safe but adds confusion and unnecessary IPA API calls.

---

### 2. SQL injection via unescaped LIKE patterns in search parameters

**Severity**: Critical
**File**: `packages/core/src/services/account-lifecycle/index.ts:591`
**Status**: New

**Problem**: The `listDeletedAccounts` function constructs a LIKE pattern as:
```ts
const pattern = search ? `%${search}%` : null;
```
If `search` contains `%` or `_` characters, they act as SQL wildcards, allowing users to craft broader queries than intended. While this is a parameterized query (not raw string concatenation), the semantic meaning is altered — a search for `%` would match everything.

The same pattern exists in `packages/core/src/services/ipa/users.ts:134`:
```ts
const search = params.search ? `%${params.search.toLowerCase()}%` : null;
```

**Fix**: Escape `%` and `_` in the search input before wrapping with `%`:
```ts
const escaped = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
const pattern = `%${escaped}%`;
```
And add `ESCAPE '\'` to the SQL LIKE clause.

---

### 3. Missing `guest_expires_at` in manual `demoteToGuest` (ipa/users.ts)

**Severity**: High
**File**: `packages/core/src/services/ipa/users.ts:900-909`
**Status**: New (introduced by refactor context — `guest_expires_at` column is new)

**Problem**: The `demoteToGuest` function (used by admin actions) does NOT set `guest_expires_at` when demoting an IPA user to guest. Compare with:
- `account-lifecycle/index.ts:162-163` — lifecycle demotion DOES set `guest_expires_at`
- `ipa/sync.ts:339` — IPA sync demotion DOES set `guest_expires_at`

This means manually-demoted users will have `guest_expires_at = NULL`, effectively giving them immortal guest accounts that will never be cleaned up by `cleanupExpiredGuests`.

**Fix**: Add `guest_expires_at` computation in `demoteToGuest`:
```ts
const guestExpiresDays = await settings.get<number | null>("user.account.guest_expires_days");
const guestExpiresAt = guestExpiresDays && guestExpiresDays > 0
  ? new Date(Date.now() + guestExpiresDays * 24 * 60 * 60 * 1000) : null;
// ... add to UPDATE SET clause
```

---

### 4. Scheduler `registered` flag is not thread-safe across async calls

**Severity**: High
**File**: `packages/core/src/services/account-lifecycle/scheduler.ts:133-134, 136-178`
**Status**: New

**Problem**: The `ensureRegistered` function uses a module-level `registered` boolean flag without any mutex protection. If `start()` is called concurrently (e.g., during hot-reload or test parallelism), multiple calls could enter `ensureRegistered` before the first one sets `registered = true`, causing duplicate schedule registrations.

**Fix**: Use a promise-based guard:
```ts
let registerPromise: Promise<void> | null = null;
const ensureRegistered = (): Promise<void> => {
  if (!registerPromise) {
    registerPromise = doRegister();
  }
  return registerPromise;
};
```

---

### 5. Notification send-status check is racy

**Severity**: High
**File**: `packages/core/src/services/account-lifecycle/index.ts:401-413`
**Status**: New

**Problem**: After calling `notifications.send()` with `autoSend: true`, the code immediately queries the notification status:
```ts
const notificationRows = await sql<DbRow[]>`
  SELECT error FROM notifications.messages WHERE id = ${notification.id}::uuid LIMIT 1
`;
const sendError = (notificationRows[0]?.error as string | null) ?? null;
```
If `autoSend` triggers async email sending, the `error` field may not yet be populated when this query runs. This could lead to false positives (marking reminders as "sent" when the email actually failed).

**Fix**: Either:
1. Make the notification service return send status synchronously when `autoSend: true`, or
2. Don't check the error immediately — trust the `notifications.send()` return value, or
3. Add a small delay or use the notification service's status-checking API if one exists.

---

### 6. Guest user creation via magic link does NOT set `guest_expires_at`

**Severity**: Medium
**File**: `packages/core/src/api/auth.ts:271-276`
**Status**: New

**Problem**: When a new guest user is created via the magic link flow (`/auth/verify-token`), the INSERT does not set `guest_expires_at`:
```ts
const rows = await sql`
  INSERT INTO auth.users (uid, realm, mail, given_name, sn, display_name)
  VALUES (${guestUid}, 'guest', ${email}, '', '', '')
  RETURNING id
`;
```
This means newly-created guest users will have `guest_expires_at = NULL` and will never expire or receive reminder emails.

Similarly, in `packages/core/src/services/ipa/users.ts:372-375`, the `addGuest` function also does not set `guest_expires_at`.

**Fix**: Read `user.account.guest_expires_days` and set `guest_expires_at` on insert in both locations.

---

### 7. `extendCurrentUserAccount` has no self-extension rate limiting or cooldown

**Severity**: Medium
**File**: `packages/core/src/services/account-lifecycle/index.ts:532-585`
**Status**: New

**Problem**: Any authenticated user can call `POST /api/me/extend-account` repeatedly, each time resetting their expiry to `now() + configuredDays`. There's no cooldown, no maximum extension count, and no audit trail. A user could indefinitely extend their account, effectively defeating the expiry mechanism.

The API route does use a general `rateLimit()` middleware, but this only limits request frequency, not semantic abuse.

**Fix**: Consider:
1. Only allow extension when the account is within X days of expiry (e.g., within the reminder window).
2. Log extensions to the audit table.
3. Add a cooldown (e.g., one extension per 24h).

---

### 8. `auth/extend` redirect route uses `requireRole("*")` but then manually checks session

**Severity**: Medium
**File**: `packages/core/src/pages/create.tsx:49-56`
**Status**: New

**Problem**: The `/auth/extend` route uses `auth.requireRole("*")` (which means "no auth check"), then manually checks for a session:
```ts
.get("/auth/extend", auth.requireRole("*"), async (c) => {
  const token = auth.session.getToken(c);
  const sessionData = token ? await auth.session.getData(token) : null;
  if (!sessionData) {
    return c.redirect("/auth/login?redirectTo=%2Fauth%2Fextend", 302);
  }
  return c.redirect("/me?action=extend", 302);
})
```
This is functionally correct (unauthenticated users get redirected to login) but bypasses the standard auth middleware pattern. If the middleware changes behavior in the future, this route won't benefit.

**Fix**: Use `auth.requireRole("authenticated", auth.redirectToLogin)` instead, which does exactly the same thing but via the standard pattern. Then the handler just does `return c.redirect("/me?action=extend", 302)`.

---

### 9. Duplicated `toGeneralizedTime` function

**Severity**: Medium
**File**: `packages/core/src/services/account-lifecycle/index.ts:38-46` and `packages/core/src/services/ipa/users.ts:463-471`
**Status**: New

**Problem**: The `toGeneralizedTime` helper is copy-pasted identically in two files. DRY violation.

**Fix**: Move to `packages/core/src/services/ipa/lib.ts` (which already has `parseGeneralizedTime`) and export from there.

---

### 10. `getIpaExpiresDays` has legacy fallback that should be removed

**Severity**: Medium
**File**: `packages/core/src/services/account-lifecycle/index.ts:54-59`
**Status**: New

**Problem**: `getIpaExpiresDays` falls back to `user.account.expires_days` (legacy key) if `user.account.ipa_expires_days` is not set. Similarly, `calculateAccountExpiration` in `users.ts:448-460` does the same fallback. This legacy path should be cleaned up once migration is complete — the defaults registry already defines `user.account.ipa_expires_days` with a default of 365.

**Fix**: Remove the legacy fallback after confirming all deployments have migrated. Add a TODO/deprecation comment for now.

---

### 11. `cleanupExpiredGuests` deletes user row but doesn't clean up app-level data

**Severity**: Medium
**File**: `packages/core/src/services/account-lifecycle/index.ts:299-340`
**Status**: New

**Problem**: When deleting expired guest accounts, the code only:
1. Inserts into `deleted_accounts` audit
2. Deletes from `auth.users` (cascades to junction tables via FK)
3. Deletes Redis sessions

But it does NOT clean up app-level data that may reference the user (files, contacts, notebooks, etc.). If apps have tables with `ON DELETE CASCADE` referencing `auth.users`, this is fine. But if any app stores user IDs without FK constraints, orphaned records will remain.

**Fix**: Consider adding a lifecycle hook or event that apps can subscribe to for user deletion cleanup. Alternatively, verify that all app tables referencing `auth.users(id)` have `ON DELETE CASCADE`.

---

### 12. Pre-existing: `getByUid` returns minimal roles without group info

**Severity**: Medium
**File**: `packages/core/src/services/ipa/users.ts:100-107`
**Status**: Pre-existing

**Problem**: `getByUid` calls `buildRoles` with empty `memberofGroup` and `manages` arrays:
```ts
const roles = buildRoles({ realm, memberofGroup: [], manages: [] });
```
This means an IPA user who is actually an admin (member of GROUPS_ADMIN) will NOT have the `admin` role in this response. If `getByUid` is used for access control decisions, this could lead to privilege check bypasses.

**Fix**: Either document that `getByUid` should NOT be used for authorization, or add group loading. Check all callers to verify none rely on roles from this function for access control.

---

### 13. Pre-existing: Service session caching is not safe under concurrent requests

**Severity**: Medium
**File**: `packages/core/src/services/ipa/auth.ts:52-69`
**Status**: Pre-existing

**Problem**: The `getServiceSession` function uses a module-level `svcSession` variable. If two concurrent requests find `svcSession` expired and both call `login()` at the same time, there's a race where:
1. Request A finds svcSession expired
2. Request B finds svcSession expired
3. Both call `login()` simultaneously
4. Both succeed and overwrite `svcSession`

This is mostly harmless (both get valid sessions) but wastes an IPA login call. More concerning: if one login fails while the other succeeds, the failing request might throw while the variable is in an inconsistent state.

**Fix**: Use a mutex or a promise cache:
```ts
let sessionPromise: Promise<string> | null = null;
```

---

### 14. Pre-existing: Bearer token extraction doesn't validate format

**Severity**: Low
**File**: `packages/core/src/services/session/index.ts:29`
**Status**: Pre-existing

**Problem**: The bearer token extraction uses simple string replacement:
```ts
const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
```
This will accept `Bearer ` prefix anywhere in the string and only replaces the first occurrence. It also accepts `Authorization: NotBearer sometoken` (since `replace` won't match). More robustly, use a regex or explicit startsWith check.

**Fix**:
```ts
const authHeader = c.req.header("Authorization");
const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
```

---

### 15. Pre-existing: Email login doesn't check if IPA user exists before sending magic link

**Severity**: Low
**File**: `packages/core/src/api/auth.ts:196-203`
**Status**: Pre-existing

**Problem**: When an IPA user requests email login, the code correctly returns `requiresPassword: true`. However, if the email matches multiple users (possible if a user was demoted to guest and a new IPA user has the same email), only `userRows[0]` is checked. The unique index on `mail` (line 62-63 of auth migration) prevents this at the DB level for non-null emails, so this is safe.

No fix needed — noting for completeness.

---

### 16. `listReminderCandidates` queries could be combined

**Severity**: Low
**File**: `packages/core/src/services/account-lifecycle/index.ts:190-236`
**Status**: New

**Problem**: Two separate queries (IPA + guest) are run sequentially. These could be combined into a single UNION query for efficiency.

**Fix**: Optional optimization — combine into a single query with a `CASE` expression for `kind`.

---

### 17. `runIpaBackfill` uses `Math.max(configuredDays, 7)` silently

**Severity**: Low
**File**: `packages/core/src/services/account-lifecycle/index.ts:461`
**Status**: New

**Problem**: The minimum backfill duration is silently clamped to 7 days. If an admin configures `ipa_expires_days = 3`, the backfill will extend to 7 days without any log message indicating the override. Same for `runGuestBackfill` (line 513).

**Fix**: Log when the clamping occurs.

---

## Inconsistencies

### Logger naming conventions

| File | Logger name | Expected pattern |
|---|---|---|
| `account-lifecycle/index.ts` | `"auth:lifecycle"` | Consistent |
| `account-lifecycle/scheduler.ts` | `"scheduler"` | Should be `"auth:lifecycle:scheduler"` |
| `account-lifecycle/scheduler.ts` | `"auth:ipa:sync"`, etc. | Fine — matches job IDs |
| `ipa/sync.ts` | `"ipa-sync"` | Uses dash not colon — should be `"auth:ipa:sync"` or `"ipa:sync"` |

### Demotion field handling

Three different code paths demote users to guest with slightly different field handling:

| Path | Sets `guest_expires_at` | Clears `employee_type` | Deletes groups |
|---|---|---|---|
| `account-lifecycle/index.ts:demoteUserToGuest` | Yes | Yes | Yes (in tx) |
| `ipa/sync.ts:329-354` | Yes | Yes | Yes (deletes all guest user_groups) |
| `ipa/users.ts:demoteToGuest` | **No** | Yes | Yes (separate queries) |

The inconsistency in `guest_expires_at` is a bug (Finding #3). The group deletion approach also differs — sync deletes ALL guest user_groups, while lifecycle and users.ts delete only for the specific user.

### API response shape

- `POST /api/me/extend-account` returns `{ message, newExpiry? }` — non-standard shape
- Other mutation endpoints return `{ message }` — standard shape
- Admin lifecycle endpoints use `respond()` wrapper while the extend endpoint uses `respond()` too — consistent

---

## Dead or Duplicate Code

### 1. Duplicate `toGeneralizedTime`
- `packages/core/src/services/account-lifecycle/index.ts:38-46`
- `packages/core/src/services/ipa/users.ts:463-471`
Exact duplicates. Should be consolidated.

### 2. Legacy type alias
- `packages/core/src/services/ipa/users.ts:968`
```ts
type LegacyMutationResult = { ok: true } | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 500 };
```
This type is defined but never used. Remove it.

### 3. Deprecated `add` function
- `packages/core/src/services/ipa/users.ts:611-620`
The `add` function is marked `@deprecated` and wraps `addIpa`. Check if any callers still use it and remove.

### 4. `AddUserResult` type alias
- `packages/core/src/services/ipa/users.ts:965`
```ts
export type AddUserResult = AddIpaResult;
```
If nothing imports `AddUserResult`, remove it.

### 5. `EmptyJobInput` type
- `packages/core/src/services/account-lifecycle/scheduler.ts:18`
```ts
type EmptyJobInput = Record<string, never>;
```
Used only in `satisfies` checks at lines 196-198. The `satisfies` usage is cosmetic — `{}` already satisfies `z.object({})`. Consider removing.

---

## KISS/DRY Refactor Opportunities

### 1. Consolidate demotion logic
Three separate demotion implementations (lifecycle service, IPA sync, IPA users) share ~80% of the same SQL. Extract a shared `demoteToGuestInDb(userId, guestExpiresAt)` function that handles the UPDATE + group cleanup. All three callers would use it.

### 2. Centralize guest expiry computation
The pattern `getGuestExpiresDays() → compute Date` appears in 4+ locations. Extract a helper:
```ts
const computeGuestExpiresAt = async (): Promise<Date | null> => { ... };
```

### 3. Consolidate account expiry computation
`calculateAccountExpiration()` in `users.ts` and `getIpaExpiresDays()` in `account-lifecycle/index.ts` serve similar purposes but with different interfaces. Unify.

### 4. Lifecycle summary type is generic but always used the same way
The `LifecycleSummary` type is fine but the iteration pattern (scan rows, try/catch per row, increment counters) is repeated 3+ times. Consider a helper:
```ts
const processBatch = async <T>(rows: T[], fn: (row: T) => Promise<void>): Promise<LifecycleSummary>
```

---

## Safety Checklist Assessment

### Migration Idempotency
**PASS**: All DDL uses `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS`. The new lifecycle tables (`deleted_accounts`, `account_lifecycle_reminders`) follow this pattern. The unique index on reminders is also idempotent.

### Runtime Deletion Safety
**PASS with caveat**: Guest deletion only happens via `cleanupExpiredGuests()` at runtime, never in migration. However, the `guest_expires_at` column defaults to `NULL` (no expiry), which means existing guests won't be deleted unless a backfill is run. This is safe but means the feature is opt-in via backfill — document this.

### Reminder Dedup Guarantees
**PASS**: The `upsertReminderAttempt` function uses `ON CONFLICT (user_id, kind, threshold_days, target_expiry_at)` with a `DO UPDATE` that preserves the `sent` status. This means:
- A reminder won't be re-sent if already `sent`
- If the target expiry changes (e.g., user extends account), a new reminder row is created (different `target_expiry_at`)
- `error` status allows retry on next run

**Minor concern**: If a user extends their account, old reminder rows with the previous `target_expiry_at` remain in the table as `sent`. They'll be cleaned up after `AUDIT_RETENTION_DAYS` but could accumulate. This is acceptable.

### Scheduler Reliability Assumptions
**MOSTLY PASS**:
- `misfire: "skip"` is correct for all schedules — if a run is missed, skip it rather than running stale work
- `strictHandlers: true` ensures unhandled schedule IDs cause errors
- The `start()`/`stop()` lifecycle is properly wired into runtime boot/shutdown
- **Concern**: The `registered` flag race (Finding #4) could cause issues on startup

### Auth/Session Robustness
**PASS with pre-existing concerns**:
- Session tokens are properly formatted as `userId:randomToken`
- Redis TTL matches cookie `maxAge`
- `deleteAllForUser` uses `KEYS` pattern scan which is O(N) — acceptable for low user counts but could be slow at scale
- Bearer token extraction is loose (Finding #14) but not exploitable
- Guest sessions store empty IPA session string (`""`) which is handled correctly downstream

---

## Open Questions / Unclear Intent

1. **Should `syncFromIpa` still run demotion?** The IPA sync job in `scheduler.ts:44-49` runs both `syncFromIpa()` and `demoteExpiredIpaUsers()`. But `syncFromIpa` already demotes expired users (filters them out of `activeUsers` and demotes IPA users not in the active set). The explicit `demoteExpiredIpaUsers()` call seems redundant for the sync-triggered case. Is the intent that `demoteExpiredIpaUsers` handles users whose `ipa_account_expires` has passed but who are still in IPA (i.e., IPA didn't remove them)?

2. **What happens to app data when a user is deleted?** `cleanupExpiredGuests` deletes from `auth.users` with cascade, but it's unclear whether all app tables have proper FK cascades. If any app stores `user_id` without FK, orphaned data will remain.

3. **Is the reminder email template configurable per-kind?** Currently both IPA and guest expiry reminders use the same template (`user.login.account_expires_email`) with an `ACCOUNT_KIND` variable. Is there a need for separate templates?

4. **Should `extendCurrentUserAccount` require re-authentication?** Currently any authenticated user can extend. For security-sensitive deployments, requiring password re-entry might be appropriate.

5. **The `parseReminderCron` reads settings once at registration time.** If an admin changes `user.account.reminder_time` via the settings UI, the scheduler cron won't update until the next restart. Is dynamic cron update needed?

6. **`runGuestBackfill` extends ALL guests** (including those who were manually set to never expire via `guest_expires_at = NULL`). Is this intentional? It effectively overrides manual admin decisions. The condition `guest_expires_at IS NULL OR guest_expires_at < target` means a manually-cleared expiry will be re-populated.
