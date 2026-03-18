# Flow Review: Sync & Lifecycle Flows

## Scope

Flows 20-23 from the required list.

---

## Flow 20: IPA sync demotes or deletes missing IPA accounts

**Intended behavior:** When an IPA user disappears from FreeIPA, the local account is handled according to the transition policy.

**Code path:**

### Phase A: Sync detects stale users
1. `scheduler.ts:ipaSyncJob` triggers `providers.ipa.sync.run()` (which is `ipa/sync.ts:syncFromIpa`)
2. `syncFromIpa()`:
   - Fetches all users from FreeIPA via `freeipa.client.call("user_find", ...)`
   - Fetches all local IPA users from `auth.users WHERE provider = 'ipa'`
   - Compares: any local IPA user whose UID is NOT in the FreeIPA response is "stale"
   - Safety: if stale count > `staleLimit` (20% of local IPA users or at least 10), aborts sync
   - Returns stale user UIDs

### Phase B: Demotion of stale users
1. After sync, `accountLifecycle.demoteExpiredIpaUsers()` runs
2. Queries `auth.users WHERE provider = 'ipa' AND account_expires < now()`
3. For each expired user:
   - Calls `deleteFromFreeIpa()` -- deletes from FreeIPA, handles "already missing" gracefully
   - Begins local transaction: calls `applyIpaAccountTransitionPolicy()`
   - Policy evaluation:
     - `"delete"`: deletes user from local DB + writes audit
     - `"demote_to_local"`: preserves current profile, transitions to local
     - `"demote_to_local_guest"`: forces guest profile, transitions to local
     - `"demote_to_local_user"`: forces user profile, transitions to local
   - `transitionIpaUserToLocal()`: clears IPA relations, sets provider to "local", computes expiry

**Issues found:**

1. **Phase B runs on expired users, not stale users.** The sync (Phase A) identifies stale users but doesn't directly trigger demotion. Instead, `demoteExpiredIpaUsers()` queries by expiry date. For a stale user whose expiry hasn't passed yet, they would remain as `provider: "ipa"` in the local DB even though they no longer exist in FreeIPA. On login, `syncUser()` would fail to find them in IPA and the user would get an error.

   The backfill job (`runIpaBackfill`) is supposed to set expiry for IPA users who are missing from FreeIPA, but only if their expiry is null or in the future. There's a gap: a stale user with a far-future expiry won't be demoted until that expiry passes.

2. **FreeIPA deletion before local transaction** (SL-01). If the local transaction fails after FreeIPA deletion, the user is in a limbo state (deleted from IPA but still `provider: "ipa"` locally).

3. **Stale user handling gap:** The sync returns stale UIDs but `demoteExpiredIpaUsers` doesn't use them. The two operations are decoupled -- sync identifies staleness, demotion acts on expiry. The intended link is: sync would update `account_expires` to trigger demotion later, but this doesn't happen during sync. The backfill is needed to close this gap.

**Verdict:** The flow works under normal conditions (IPA user disappears + expiry passes). There is a gap for stale users whose expiry hasn't passed yet -- they remain in a "IPA provider but not in FreeIPA" state until expiry or backfill.

---

## Flow 21: Lifecycle handles expired IPA account

**Intended behavior:** An IPA user whose account has expired is demoted or deleted.

**Code path:**
1. `scheduler.ts` triggers `demoteExpiredIpaUsers()` as part of the sync job
2. Query: `SELECT * FROM auth.users WHERE provider = 'ipa' AND account_expires IS NOT NULL AND account_expires < now()`
3. For each:
   - `deleteFromFreeIpa(uid)` -- FreeIPA deletion with "not found" graceful handling
   - Begin transaction:
     - Read `identity.ipa_account_transition_policy` setting
     - Execute policy: `applyIpaAccountTransitionPolicy()`
     - This calls `transitionIpaUserToLocal()` (for demote policies) or deletes the user (for delete policy)
     - Writes audit trail
   - End transaction
   - Revoke sessions

**Issues found:**
- **No batching.** Each user is processed individually with separate FreeIPA calls, DB transactions, and session revocations. For large numbers of expired users, this could be slow.
- **FreeIPA-first deletion creates the consistency window** (SL-01 repeat).
- **Session revocation is best-effort** -- failure is caught and logged. The user could remain logged in with stale session data. However, the next request would call `accounts.users.get()` which would fail to find an IPA user, effectively logging them out.

**Verdict:** Correct flow. Performance concern for batch operations. The consistency window is the main risk.

---

## Flow 22: Lifecycle handles local guest expiry

**Intended behavior:** Expired guest accounts are permanently deleted.

**Code path:**
1. `scheduler.ts` triggers `cleanupExpiredGuests()` via the `guestCleanupJob`
2. Query: `SELECT * FROM auth.users WHERE provider = 'local' AND profile = 'guest' AND account_expires IS NOT NULL AND account_expires < now()`
3. For each expired guest:
   - Calls `providers.local.users.remove()` which:
     - Writes deleted account audit
     - Deletes user from `auth.users`
     - Revokes sessions (best-effort)

**Issues found:**
- **Only local guests are cleaned up.** IPA guests (IPA users with guest profile from group membership) are handled by `demoteExpiredIpaUsers()` in Flow 21, not by this flow. This is correct -- IPA guest expiry is IPA-controlled.
- **No grace period.** As soon as `account_expires < now()` is true, the guest is deleted. There is no "expired but not yet cleaned up" state with a reminder period. However, the reminder system sends emails before expiry, so the user has advance notice.
- **Delete is permanent.** Unlike IPA users who can be demoted, local guests are always permanently deleted. The audit trail preserves their information.

**Verdict:** Correct and clean flow. The permanent deletion for guests is intentional policy.

---

## Flow 23: Lifecycle handles local user expiry

**Intended behavior:** Expired local full-user accounts are... what?

**Code path:**
Looking for handling of `provider = 'local' AND profile = 'user' AND account_expires < now()`:

1. `demoteExpiredIpaUsers()` -- only handles `provider = 'ipa'`
2. `cleanupExpiredGuests()` -- only handles `profile = 'guest'`
3. No other lifecycle function handles expired local full users

**Issue found:** **There is no lifecycle handler for expired local full-user accounts.** If `user.account.local_user_expires_days` is set to a non-zero value, local users will get an `account_expires` date from the backfill. But when that date passes, nothing happens. The user remains active with an expired timestamp.

The backfill job (`runLocalUserBackfill`, lifecycle/index.ts:557) sets expiry dates, and the reminder system sends emails for approaching expiry. But no job actually acts on the expiry when it passes.

This may be intentional -- local full users might be expected to self-service extend or an admin should manually handle them. But it creates an inconsistency:
- IPA expired users: automatically demoted/deleted
- Local guests: automatically deleted
- Local full users: **nothing happens**

The default setting is `local_user_expires_days = 0` (disabled), which means this gap doesn't manifest in default configuration. But if an admin enables local user expiry, they might expect automatic action.

**Verdict:** Missing lifecycle handler for expired local full users. This is likely a design gap rather than a bug, since the default config disables local user expiry. But it should be documented.

---

## Cross-flow Issues

| Issue | Affected Flows | Severity |
|-------|---------------|----------|
| FreeIPA-first deletion consistency window | 20, 21 | High |
| Stale IPA users with future expiry not handled | 20 | Medium |
| No lifecycle handler for expired local users | 23 | Medium |
| No batching for mass demotions | 20, 21 | Low |
| Self-service extend with 0-day config | (relates to 23) | Medium |

## Conclusion

The lifecycle flows are well-structured for the common cases. The main gaps are:

1. **Stale IPA user handling** relies on expiry + backfill rather than direct action during sync
2. **FreeIPA-first deletion** creates an unavoidable consistency window
3. **No automatic action for expired local full users** -- this is a design gap if local user expiry is enabled
4. The interplay between sync, backfill, and demotion is correct but requires all three to function together for complete lifecycle management
