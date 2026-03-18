# Module Review: Accounts API — Me & Requests

## Scope

`packages/apps/src/accounts/api/me.ts` (~207 lines)
`packages/apps/src/accounts/api/me/schemas.ts` (~27 lines)
`packages/apps/src/accounts/api/account-requests.ts` (~229 lines)
`packages/core/src/services/accounts/app.ts` (request logic, lines ~496-720)

Self-service profile routes and account request CRUD.

---

## Findings

### MR-01 | medium | `PATCH /me` does not use `respond()` wrapper

**Impact:** Unhandled exceptions produce raw 500 instead of structured error responses.

`me.ts:63-76` manually calls `c.json(...)` for error handling while all other endpoints in the same file use the `respond()` helper. An unhandled exception from `accounts.users.update()` would propagate as an unstructured 500 error.

**Files:** `api/me.ts:63-76`

---

### MR-02 | medium | No rate limiting on account request creation

**Impact:** A denied user can immediately resubmit a request. No cooldown.

`app.ts:636` checks for existing pending requests (line 645) but a denied user can create a new request immediately. No attempt counter or cooldown mechanism exists.

**Files:** `app.ts:636-660`

---

### MR-03 | medium | Account request SQL blocks duplicated 4 times

**Impact:** DRY violation -- four nearly identical SQL blocks for list variants.

`app.ts:496-603` has four nearly identical SQL blocks for admin scope variants (pending, completed, denied, all) that differ only in the WHERE clause. These should be a single parameterized query.

**Files:** `app.ts:496-603`

---

### MR-04 | medium | Missing explicit `POST /:id/approve` endpoint for account requests

**Impact:** Request completion relies on side-effects of user creation.

There is a deny endpoint but no explicit approve endpoint. Approval happens through the user creation flow (`users.ts`), where `requestId` is passed to mark the request as completed. If an admin creates the user without the `requestId`, the request stays "pending" forever.

**Files:** `api/account-requests.ts` (no approve route), `api/users.ts` (implicit via `requestId` in create payload)

---

### MR-05 | low | SSH key schema accepts any string

**Impact:** Arbitrary strings stored as SSH keys.

`me/schemas.ts:14` validates `UpdateSshKeysSchema` as `z.array(z.string())` with no format check. The frontend validates SSH key format, but the API does not. A malicious or broken client could store non-SSH-key strings.

**Files:** `api/me/schemas.ts:14`

---

### MR-06 | low | No minimum password length in ChangePasswordSchema

**Impact:** Single-character passwords accepted by the API.

`me/schemas.ts:20-21` requires `newPassword` to have `.min(1)`. The IPA backend may enforce its own policy, but the API layer should provide basic validation.

**Files:** `api/me/schemas.ts:20-21`

---

### MR-07 | low | `DELETE /me` self-deletion is guest-only but the route accepts any provider

**Impact:** The route handler correctly checks provider and profile, but the authorization middleware only requires `"authenticated"`. A non-guest calling this endpoint gets a specific error rather than a 403.

**Files:** `api/me.ts:159-196`

---

## Open Questions / Assumptions

1. Should there be a cooldown between account request submissions after denial?
2. Should SSH key format be validated server-side?
3. Should the account request have an explicit approve action instead of relying on user creation side-effects?

## Conclusion

The self-service API is cleanly structured with appropriate provider-conditional guards. The main concerns are the missing `respond()` wrapper on PATCH (MR-01), the account request DRY violation (MR-03), and the implicit approval flow (MR-04) which couples request lifecycle to user creation. Schema validation is permissive on SSH keys and passwords but FreeIPA may enforce stricter rules server-side.
