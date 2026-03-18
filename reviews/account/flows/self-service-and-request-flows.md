# Flow Review: Self-Service & Request Flows

## Scope

Flows 15-19 from the required list.

---

## Flow 15: Self-service `/api/accounts/me` profile update

**Intended behavior:** Authenticated user updates their own name, phone, or address.

**Code path:**
1. `api/me.ts PATCH /` -> `auth.requireRole("authenticated")`
2. Validates against `UpdateProfileSchema`
3. Gets IPA session if available
4. Calls `accounts.users.update()` directly (NOT via `app.ts` facade)
5. `accounts/users.ts:update()`:
   - Calls `get()` to verify user exists (full recursive CTE query)
   - For IPA users: calls `providers.ipa.users.update()` (FreeIPA + local DB update)
   - For local users: calls `providers.local.users.update()` (local DB only)

**Issues found:**
- **Does not use `respond()` wrapper** (MR-01). Unhandled exceptions produce raw 500s.
- **Full `get()` called just to check existence** (CU-01). A lightweight existence check would suffice.
- **IPA update writes to FreeIPA first.** If the FreeIPA call succeeds but the local DB update fails, the user has divergent data between FreeIPA and the local DB. The next sync would reconcile this.

**Verdict:** Correct flow with minor error handling and performance concerns.

---

## Flow 16: Self-service account extension

**Intended behavior:** User extends their own account expiry.

**Code path:**
1. `api/me.ts POST /extend-account` -> `auth.requireRole("authenticated")`
2. Calls `accountLifecycle.extendCurrentUserAccount({ user, ipaSession })`
3. `lifecycle/index.ts:extendCurrentUserAccount()`:
   - Reads configured expiry days for the user's provider/profile
   - Computes new expiry as max(current_expiry, now) + configured_days
   - For IPA users: calls `freeipa.client.call("user_mod", ...)` to set `krbprincipalexpiration`
   - Updates `account_expires` in local DB
   - Returns success message with new expiry date

**Issues found:**
- **Uses FreeIPA client directly** (not through providers layer). Lifecycle bypasses the provider abstraction.
- **If configured expiry days = 0** (disabled), the function still tries to extend. It computes `now + 0 days = now`, effectively setting expiry to "now". This would immediately expire the account. Should check for 0 and return "extension not available".

**Verdict:** Potential bug when `expires_days = 0`. IPA direct-call is acceptable for lifecycle operations.

---

## Flow 17: Local user creates account request

**Intended behavior:** A local user requests a FreeIPA-backed account.

**Code path:**
1. `api/account-requests.ts POST /` -> `auth.requireRole("authenticated")`
2. Validates request body (comment, acceptedAgb)
3. `app.ts:accountRequest.create()`:
   - Checks user is `provider === "local"` (line 642)
   - Checks no pending request exists (line 645)
   - Inserts into `auth.account_requests` with `user_id`, `status: "pending"`, `comment`, `accepted_agb`

**Issues found:**
- **No rate limiting after denial** (MR-02). A denied user can immediately resubmit.
- **The request table stores `user_id` only** -- profile data (name, email) is read from the join with `auth.users` at query time. This means if the user changes their name after submitting, the admin sees the updated name, not the name at submission time. This is probably fine but is a design choice.
- **`acceptedAgb: true` is required** but only validated at the API level. The DB stores it but never reads it back for enforcement.

**Verdict:** Correct flow. Missing rate limiting after denial.

---

## Flow 18: Local user withdraws account request

**Intended behavior:** User cancels their pending request.

**Code path:**
1. `api/account-requests.ts DELETE /:id` -> `auth.requireRole("authenticated")`
2. `app.ts:accountRequest.withdraw()`:
   - Verifies request exists with `status: "pending"` AND `user_id = userId` (line 669-671)
   - Deletes the row from `auth.account_requests`

**Issues found:**
- **Hard delete instead of soft delete** (SL-05). No audit trail for withdrawn requests. If the product needs to track "how many requests were withdrawn", this data is lost.
- **Only the owner can withdraw** -- the query includes `user_id = $userId` in the WHERE. An admin cannot withdraw on behalf of a user through this endpoint. This is intentional (admins use the deny flow instead).

**Verdict:** Correct authorization. Hard delete is an audit trail concern.

---

## Flow 19: Admin denies account request

**Intended behavior:** Admin denies a pending request, optionally with a reason and email notification.

**Code path:**
1. `api/account-requests.ts POST /:id/deny` -> `auth.requireRole("admin")`
2. `app.ts:accountRequest.deny()`:
   - Updates request status to `"denied"`, sets `reviewed_by`, `reviewed_at`, `deny_reason`
   - If `reason` is provided: sends denial email to user
   - If `reason` is NOT provided: no email is sent

**Issues found:**
- **Silent denial when no reason is given** (noted in app.ts analysis). The user is denied but never notified. They would need to check the dashboard to discover their request was denied. The UI always provides a reason (via `DenyRequest.island.tsx` form), but the API allows it to be omitted.
- **No notification of denial outcome on dashboard.** The dashboard shows "pending" state. When the request is denied, the user would see the request disappear (since non-pending requests aren't shown on the dashboard's "pending request" section). They might not realize it was denied vs. still processing.

**Verdict:** Correct flow but the notification gap is a UX concern. API should require a reason or always notify.

---

## Cross-flow Issues

| Issue | Affected Flows | Severity |
|-------|---------------|----------|
| Self-service extend with 0-day config | 16 | Medium |
| Missing rate limit after denial | 17 | Medium |
| Hard delete on withdraw | 18 | Low |
| Silent denial without notification | 19 | Low |
| Full `get()` for existence checks | 15, 16 | Medium |

## Conclusion

Self-service flows are clean and correctly scoped. The account request lifecycle works but has edge cases: the 0-day extension bug (Flow 16), missing rate limiting (Flow 17), and the silent denial path (Flow 19). The request approval happens as a side-effect of user creation (not an explicit "approve" action), which is architecturally sound but means requests can get stuck if the admin creates the user without the `requestId`.
