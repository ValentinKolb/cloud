# Module Review: Core Switching & Lifecycle

## Scope

`packages/core/src/services/accounts/switching.ts` (133 lines)
`packages/core/src/services/account-lifecycle/index.ts` (832 lines)
`packages/core/src/services/account-lifecycle/audit.ts` (49 lines)
`packages/core/src/services/account-lifecycle/scheduler.ts` (335 lines)

Covers provider switching, account demotion/deletion, expiry backfill, reminders, and scheduling.

---

## Findings

### SL-01 | high | `demoteExpiredIpaUsers` deletes from FreeIPA before local transaction

**Impact:** If FreeIPA delete succeeds but the local DB transaction fails, the user is deleted from FreeIPA but still appears as `provider = 'ipa'` locally. This is a consistency window.

In `lifecycle/index.ts:239-287`, the flow is: (1) delete from FreeIPA, (2) begin local transaction, (3) run transition policy. If step 2 or 3 fails, the FreeIPA deletion cannot be rolled back. The sync would eventually reconcile by detecting the stale user, but there is a period of divergence.

**Files:** `lifecycle/index.ts:239-243, 247-287`

---

### SL-02 | medium | `getLocalExpiryDays()` duplicated between switching.ts and users.ts

**Impact:** DRY violation -- if defaults change in one place but not the other, behavior diverges.

`switching.ts:37-45` defines `getLocalExpiryDays()` reading `user.account.local_user_expires_days` and `user.account.local_guest_expires_days`. The same logic exists in `users.ts` as `getConfiguredExpiryDays()`. Both have identical defaults (0 and 365 respectively).

**Files:** `switching.ts:37-45`, `users.ts:61-77`

---

### SL-03 | medium | IPA sync job chains sync + demotion without step isolation

**Impact:** If sync succeeds but demotion throws, the entire job retries including the sync.

In `scheduler.ts:84-108`, the `ipaSyncJob` runs `providers.ipa.sync.run()` then `accountLifecycle.demoteExpiredIpaUsers()`. If demotion fails, the retry includes re-running the full IPA sync. The `ctx.step` mechanism should provide idempotency, but this is unclear from the code.

**Files:** `scheduler.ts:84-108`

---

### SL-04 | medium | `cleanupExpiredGuests` and `demoteExpiredIpaUsers` share deletion pattern but with divergent implementations

**Impact:** Maintenance burden and subtle behavioral differences.

- `demoteExpiredIpaUsers()` (line 214) handles FreeIPA deletion + local transition via `applyIpaAccountTransitionPolicy`
- `cleanupExpiredGuests()` (line 312) directly deletes via `providers.local.users.remove`

Both need audit trail and session revocation. The IPA path uses a complex policy evaluation, while the guest path is straightforward. The FreeIPA deletion + "not found" handling pattern appears 3 times in the codebase (see CG-06 in ipa-groups-sync module).

**Files:** `lifecycle/index.ts:214-310, 312-368`

---

### SL-05 | low | `accountRequest.withdraw` permanently deletes instead of soft-delete

**Impact:** No audit trail for withdrawn requests.

In `app.ts:675-677`, withdrawing a request uses `DELETE` which permanently removes the row. Denial uses status change to `'denied'`. This asymmetry means withdrawn requests leave no trace for admin review.

**Files:** `app.ts:675-677`

---

### SL-06 | low | `logCleanupJob` is registered in the lifecycle scheduler but is not lifecycle-related

**Impact:** Scope creep -- application log cleanup is architecturally misplaced in the account lifecycle scheduler.

`scheduler.ts:159-183` registers `app:logs:cleanup` alongside account lifecycle jobs. This works but couples general log retention to account lifecycle scheduling.

**Files:** `scheduler.ts:159-183`

---

### SL-07 | low | Guest expiry asymmetry in defaults

**Impact:** Possible surprise for admins.

`getGuestExpiresDays` defaults to 365 when setting is null/empty (`lifecycle/index.ts:53-60`), while `getLocalUserExpiresDays` defaults to 0 (disabled). This means guests always expire by default, but local full users never do. This is likely intentional policy but is not documented in settings descriptions.

**Files:** `lifecycle/index.ts:52-60`

---

### SL-08 | low | Dual-write to legacy columns in `transitionIpaUserToLocal()`

**Impact:** Complexity that should be removed post-migration.

`switching.ts:70-111` writes both canonical columns (`provider`, `profile`, `account_expires`) and legacy columns (`realm`, `ipa_account_expires`, `guest_expires_at`) via `legacyAccountColumnsFromCanonical`. Same pattern as all other write paths.

**Files:** `switching.ts:70-111`

---

## Open Questions / Assumptions

1. Does `ctx.step` in the scheduler provide idempotency for the sync->demotion chain?
2. Should withdrawn requests be preserved with a `'withdrawn'` status instead of deleted?
3. Is the guest expiry default (365 days) vs local user default (0 = never) intentional policy or an oversight?

## Conclusion

The lifecycle system is functionally complete and covers all account expiry scenarios. The main correctness concern is the FreeIPA-first deletion in `demoteExpiredIpaUsers` which creates a consistency window. The DRY violations around expiry configuration are low-risk but should be unified. The scheduler appropriately handles job isolation and retries.
