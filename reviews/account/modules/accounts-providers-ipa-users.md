# Module Review: IPA Provider — Users

## Scope

`packages/core/src/services/ipa/users.ts` (1084 lines)
`packages/core/src/services/ipa/auth.ts` (76 lines)
`packages/core/src/services/ipa/profile.ts` (85 lines)
`packages/core/src/services/ipa/search.ts` (126 lines)

IPA user CRUD, authentication, profile calculation, and entity search.

---

## Findings

### IU-01 | medium | `generatePassword()` has modular bias

**Impact:** Non-uniform password distribution (minor practical impact for temporary passwords).

`ipa/users.ts:449-473` uses `bytes[i] % charset.length` which introduces modular bias since 256 is not evenly divisible by most charset lengths. The `generateAbbreviation()` function (line 411) correctly uses rejection sampling, showing inconsistency within the same file.

**Files:** `ipa/users.ts:449-473` vs `ipa/users.ts:411-419`

---

### IU-02 | medium | `generatePassword()` shuffle reuses random bytes

**Impact:** Fisher-Yates shuffle is non-uniform.

Lines 467-469 reuse the same 16 random bytes (`bytes[i % bytes.length]`) for shuffle indices instead of generating fresh random values for each swap. This makes the password character ordering predictable.

**Files:** `ipa/users.ts:467-469`

---

### IU-03 | medium | Duplicate recursive CTE patterns (9+ instances)

**Impact:** DRY violation across the module, maintenance burden.

The same recursive CTE for group hierarchy traversal appears in:
- `ipa/users.ts:get()` (lines 79-98, 101-122) -- twice in one query
- `ipa/users.ts:getGroups()` (lines 243-259)
- `ipa/users.ts:getManagedGroups()` (lines 296-316)
- `ipa/groups.ts:getMembers()` (lines 158-174)
- `ipa/groups.ts:getManagers()` (lines 233-261)
- `ipa/groups.ts:getParents()` (lines 297-312)
- `ipa/profile.ts:getAllUserGroups()` (lines 17-36)
- `ipa/groups.ts:list()` userId filter (lines 101-120)

No shared SQL builder exists for these.

**Files:** Multiple (see list above)

---

### IU-04 | low | `setExpiry` manually formats IPA generalized time

**Impact:** Inconsistency -- `freeipa.util.toGeneralizedTime()` is available but not used here.

`ipa/users.ts:869` formats the date as `date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z"`, while `freeipa.util.toGeneralizedTime()` is used elsewhere (line 557). Should use the utility consistently.

**Files:** `ipa/users.ts:869` vs `ipa/users.ts:557`

---

### IU-05 | low | `updateProfile` has separate mail update query

**Impact:** Brief inconsistency window between the main UPDATE and mail UPDATE.

`ipa/users.ts:723-725` runs a second UPDATE for mail after the main profile update. This could be folded into the main query.

**Files:** `ipa/users.ts:723-725`

---

### IU-06 | low | `demoteToGuest` does not clear `phone` field

**Impact:** IPA-specific phone data may persist after demotion.

Lines 950-962 clear `employee_type`, `addr_*`, `mobile`, `ssh_*` fields but `phone` is not NULLed. If the phone was set via FreeIPA, it persists into the local guest account.

**Files:** `ipa/users.ts:950-962`

---

### IU-07 | low | `changeExpiredPassword` has no timeout on `fetch()`

**Impact:** Login hangs if FreeIPA is unresponsive.

`ipa/auth.ts:27` uses raw `fetch()` without a timeout. Other IPA calls go through `freeipa.client.call` which presumably has timeout handling.

**Files:** `ipa/auth.ts:27`

---

### IU-08 | low | `updateUserIpaProfile` has N+1 pattern for group changes

**Impact:** Performance for group mutations affecting many users.

`ipa/profile.ts:68-84` loops through affected users and calls `updateUserIpaProfile` for each, triggering a separate recursive CTE + UPDATE per user. Could be optimized with a single bulk update.

**Files:** `ipa/profile.ts:68-84`

---

### IU-09 | low | Search has no minimum query length

**Impact:** Single-character searches produce broad DB scans.

`ipa/search.ts:36` accepts any query string including single characters. The `LIMIT 10` prevents excessive results but the DB still scans widely with `%{query}%` LIKE patterns.

**Files:** `ipa/search.ts:36`

---

## Open Questions / Assumptions

1. Is the phone field intentionally preserved during demotion?
2. Should the recursive CTE pattern be extracted into a shared SQL builder?
3. Should `generatePassword` use the same rejection sampling as `generateAbbreviation`?

## Conclusion

The IPA user module is the largest and most complex module in the system. It is functionally correct for its domain. The main concerns are the password generation quality (IU-01/02), the extensive CTE duplication (IU-03), and the N+1 profile update pattern (IU-08). The `addIpa` function correctly handles guest-to-IPA promotion and the `demoteToGuest` function correctly strips IPA-specific data (minus phone).
