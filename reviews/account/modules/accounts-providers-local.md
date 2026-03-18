# Module Review: Local Provider

## Scope

`packages/core/src/services/providers/local/auth.ts` (13 lines)
`packages/core/src/services/providers/local/users.ts` (246 lines)
`packages/core/src/services/providers/local/index.ts`

Magic-link authentication and local user CRUD.

---

## Findings

### PL-01 | medium | Local provider imports UID generation from IPA module

**Impact:** Leaky provider boundary. The local provider depends on `../../ipa/users.generateUniqueAbbreviation`.

`local/users.ts:6` imports `generateUniqueAbbreviation` from the IPA user module. This means the local provider cannot function without the IPA module being available. The UID generation logic should be extracted to a shared utility.

**Files:** `local/users.ts:6, 21-24`

---

### PL-02 | medium | `setProfile` and `setExpiry` are near-duplicates

**Impact:** DRY violation -- both query+guard+update with identical structure.

Both functions:
1. Query `SELECT provider FROM auth.users WHERE id = ...`
2. Check `provider === 'local'`
3. Compute `legacyAccountColumnsFromCanonical`
4. Run an `UPDATE`

They differ only in which columns they update. A shared internal helper would eliminate ~30 lines of duplication.

**Files:** `local/users.ts:133-166` (setProfile), `local/users.ts:168-198` (setExpiry)

---

### PL-03 | low | Audit schema leaks IPA concepts into local deletion path

**Impact:** Abstraction leak -- local-only deletions include `deletedFromFreeIpa: false` and `freeIpaUserAlreadyMissing: false`.

`local/users.ts:227-228` passes these FreeIPA-specific audit metadata fields even for purely local account deletions. The audit schema (`lifecycle/audit.ts`) expects these fields because it was designed for IPA-centric operations.

**Files:** `local/users.ts:227-228`

---

### PL-04 | low | `create()` does not handle duplicate email at the service level

**Impact:** DB constraint violation produces an unstructured error.

If a user with the same email already exists, the INSERT will fail with a PostgreSQL unique constraint error. The service does not catch this and return a friendly `MutationResult`. Callers would see a raw SQL error.

**Files:** `local/users.ts:26-69`

---

### PL-05 | low | `createGuest` allows `null` expiry via explicit `accountExpires: null`

**Impact:** A guest with no expiry is possible, bypassing the lifecycle system.

`local/users.ts:78-83` only applies the default expiry when `params.accountExpires === undefined`. If a caller passes `null`, no expiry is set. This may be intentional but allows creating a guest that never expires.

**Files:** `local/users.ts:78-83`

---

### PL-06 | low | Magic link `JSON.parse` without schema validation

**Impact:** Redis data corruption would produce an untyped result.

`local/auth.ts:12` does `JSON.parse(raw) as { email: string }`. The stored value is controlled by the same module, so exploitation risk is low. Defensive parsing would be more robust.

**Files:** `local/auth.ts:12`

---

## Open Questions / Assumptions

1. Should UID generation be extracted to a shared utility outside both providers?
2. Is the `null`-expiry path for guests intentional or should it enforce a default?

## Conclusion

The local provider is clean and minimal. The main concerns are the cross-provider import (PL-01), the duplicated guard patterns (PL-02), and the audit schema leak (PL-03). Magic link tokens are cryptographically sound (UUID + Redis TTL + atomic GETDEL).
