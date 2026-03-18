# Flow Review: User Create & Provider Switch Flows

## Scope

Flows 1-4, 5-6, 7, 8-10 from the required list.

---

## Flow 1: Create local full account

**Intended behavior:** Admin creates a local user with `profile: "user"`.

**Code path:**
1. `api/users.ts POST /` -> validates `CreateUserSchema` (discriminated on `provider: "local"`)
2. `app.ts:user.create()` (line 268) -> forces `profile: config.data.profile` for local
3. `accounts/users.ts:create()` -> calls `providers.local.users.create()`
4. `local/users.ts:create()` -> INSERT into `auth.users` with canonical + legacy columns
5. Back in `app.ts` -> optionally sends welcome email, returns `CreateUserResult`

**Issues found:**
- **No duplicate email check** at the service level. DB unique constraint catches it but error is unstructured.
- **`autoSendNotification` controls welcome email** (app.ts:290-300). If sending fails, the user is still created -- correct behavior but the admin only sees a success response without knowing the email failed.

**Verdict:** Correct flow. Minor concern on duplicate email handling.

---

## Flow 2: Create local guest account

**Intended behavior:** Admin creates a local guest with automatic expiry.

**Code path:**
Same as Flow 1 but with `profile: "guest"`. The `accounts/users.ts:create()` (line 476) calls `resolveTargetAccountExpiry()` (line 480-484) which, when `requested === undefined`, delegates to `getDefaultAccountExpiry(provider, profile)` (line 91). For a local guest, this returns `now + local_guest_expires_days` (default 365 days).

The resolved expiry is then passed to `providers.local.users.create()` (line 487-496).

**Verdict:** Correct. Default expiry is properly applied at the canonical accounts layer via `resolveTargetAccountExpiry`. No bug.

---

## Flow 3: Create IPA-backed account

**Intended behavior:** Admin creates a FreeIPA user.

**Code path:**
1. `api/users.ts POST /` -> validates `CreateUserSchema` with `provider: "ipa"`
2. `requireIpaSession()` is called to get the admin's IPA session
3. `app.ts:user.create()` (line 268) -> forces `profile: "user"` for IPA (line 274)
4. `accounts/users.ts:create()` -> calls `providers.ipa.users.create()` (which is `ipa/users.ts:addIpa()`)
5. `addIpa()`:
   - Generates unique UID abbreviation
   - Calls `freeipa.client.call("user_add", ...)` to create in FreeIPA
   - Upserts into `auth.users` with `ON CONFLICT (uid) DO UPDATE`
   - Calls `updateUserIpaProfile()` to set profile from group membership
6. Back in `app.ts` -> optionally sends welcome email

**Issues found:**
- **The UPSERT (line 559-584 in ipa/users.ts) updates the existing row by UID**, which means if a local user with the same UID exists, they get silently overwritten. This is the intended behavior for the `local -> IPA` switch path but is surprising for a fresh create.
- **Profile is forced to "user" but then immediately recalculated** by `updateUserIpaProfile()`. Since a new IPA user has no group memberships yet, they would be calculated as "guest". So the forced "user" profile from `app.ts:274` is immediately overwritten to "guest" by the profile calculation. This is a correctness concern -- the user is created as a guest, not a user, until added to the base group.

**Verdict:** The profile forcing in `app.ts:274` is misleading because the profile calculation immediately overrides it. A new IPA user starts as "guest" until group assignment.

---

## Flow 4: Create IPA account from pending request

**Intended behavior:** Admin processes an account request, creating the IPA user with prefilled data.

**Code path:** Same as Flow 3, but `requestId` is included in the payload.

1. After successful user creation, `app.ts:user.create()` checks for `config.data.requestId` (line 307)
2. If present, updates the account request status to "completed" (line 310-316)

**Issues found:**
- **If the user creation succeeds but the request status update fails**, the user exists but the request remains "pending". An admin would see the request still pending and might try to create the user again (which would fail due to duplicate UID/email).
- **The request-to-user link is not atomic.** The user creation and request completion are separate operations without a shared transaction.

**Verdict:** Non-atomic request completion is a minor consistency concern.

---

## Flow 5: Send local welcome/login path

**Intended behavior:** Admin sends a magic login link to a local user.

**Code path:**
1. `api/users.ts POST /:id/send-login-link` -> `auth.requireRole("admin")`
2. `accounts/users.ts:sendLoginLink()` -> validates user exists and has email
3. Calls `sendMagicLinkEmail()` (line 103) -> creates token via `providers.local.auth.createMagicLinkToken()`, sends email
4. Token stored in Redis with TTL

**Verdict:** Correct. Clean flow.

---

## Flow 6: Create local admin login token

**Intended behavior:** Admin creates a login token for a local user (for manual distribution).

**Code path:**
1. `api/users.ts POST /:id/create-login-token` -> admin only
2. `accounts/users.ts:createLoginToken()` -> validates user exists
3. Creates token via `providers.local.auth.createMagicLinkToken()`
4. Returns token in response (NOT sent by email)

**Verdict:** Correct. The token is returned in the API response -- admin is responsible for secure distribution.

---

## Flow 7: Reset IPA password as admin

**Intended behavior:** Admin generates a temporary password for an IPA user.

**Code path:**
1. `api/users.ts POST /:id/reset-password` -> admin only, requires IPA session
2. `accounts/users.ts:resetPassword()` -> validates user is IPA-backed
3. Calls `providers.ipa.users.resetPassword()` -> generates random password, calls `freeipa.client.call("user_mod", ...)` to set it
4. Returns success message (password is not returned to admin)

**Verdict:** Correct. The API returns `{ message, password }` (api/users.ts:220), so the admin receives the temporary password in the response. The frontend can display it for secure distribution.

---

## Flow 8: Local -> IPA provider switch

**Intended behavior:** Admin converts a local user to IPA-backed.

**Code path:**
1. `api/users.ts POST /:id/switch-provider` with `{ provider: "ipa" }` -> admin + IPA session
2. `accounts/users.ts:switchProvider()` (line 655):
   - Fetches user row (lightweight) AND full user (heavyweight) -- double fetch
   - Validates `currentProvider !== targetProvider`
   - Calls `providers.ipa.users.create()` with the existing user's name/email data
   - The IPA create UPSERTS by UID, updating the existing row to `provider: "ipa"`
   - Calls `updateUserIpaProfile()` to recalculate profile from groups
3. No explicit cleanup of "local" identity -- the UPSERT overwrites in place

**Issues found:**
- **The existing local group memberships survive** because the UPSERT doesn't touch junction tables. Local group relations are preserved. IPA group relations will be established during the next sync. This matches the documented intent.
- **Profile after switch:** The user immediately gets `profile: "guest"` (from profile calculation with no IPA groups) until the next sync adds them to groups. This is documented behavior but may surprise the admin.
- **Double fetch** (getUserRow + get) is unnecessary (see CU-02).

**Verdict:** Correct flow with expected "temporary guest" state. Double fetch is a performance issue.

---

## Flow 9: IPA -> local provider switch

**Intended behavior:** Admin converts an IPA user to local-only.

**Code path:**
1. `api/users.ts POST /:id/switch-provider` with `{ provider: "local" }` -> admin + IPA session
2. `accounts/users.ts:switchProvider()` (line 697-722):
   - Calls `freeipa.client.call(ipaSession, "user_del", [user.uid], {})` to delete from FreeIPA first (line 698)
   - Tolerates "not found" errors gracefully (lines 700-707)
   - Only then begins local transaction: `transitionIpaUserToLocal()` (lines 709-716)
   - Revokes sessions (best-effort, lines 718-722)

**Issues found:**
- **Consistency window:** FreeIPA deletion happens before the local transaction. If the local transaction fails after FreeIPA deletion succeeds, the user is deleted from FreeIPA but still shows as `provider: "ipa"` locally. The next sync would detect this as a stale user. This is the same consistency window as SL-01.
- **No re-promotion risk from manual switch.** Since the IPA account is deleted first, the sync will not find the user in FreeIPA and will not re-promote them.

**Verdict:** Correct flow. The FreeIPA deletion is properly implemented. The only remaining concern is the FreeIPA-first consistency window (shared with all IPA deletion paths).

---

## Flow 10: Local profile change `user <-> guest`

**Intended behavior:** Admin changes a local user's profile.

**Code path:**
1. `api/users.ts POST /:id/set-profile` with `{ profile: "user"|"guest" }` -> admin only
2. `accounts/users.ts:setProfile()` -> validates user is local, then delegates to `providers.local.users.setProfile()`
3. `local/users.ts:setProfile()`:
   - Guards `provider === "local"`
   - If changing to guest: computes default guest expiry if current is null/past
   - If changing to user: no expiry change
   - Updates `profile`, `account_expires`, and legacy columns

**Issues found:**
- **Changing user -> guest sets expiry, but changing guest -> user does NOT remove expiry.** If a guest had an expiry set and is promoted to user, the expiry persists. The user will still expire unless an admin manually removes it. This is documented behavior but potentially surprising.

**Verdict:** Correct but the guest->user promotion could be more helpful by clearing expiry automatically.

---

## Overall Conclusion

The create and switch flows are functionally correct for the canonical model. Key concerns:

1. ~~**Flow 2:** Admin-created guests may lack default expiry~~ **RESOLVED** -- `resolveTargetAccountExpiry` correctly applies defaults.
2. **Flow 3:** New IPA users start as "guest" despite `profile: "user"` being forced (profile is recalculated from group membership immediately).
3. ~~**Flow 9:** IPA account is not deleted from FreeIPA~~ **RESOLVED** -- `switchProvider` does delete from FreeIPA first. Remaining concern: FreeIPA-first consistency window.
4. **Flow 10:** guest->user promotion preserves expiry instead of clearing it.
