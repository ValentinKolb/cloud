# Module Review: Auth & Session

## Scope

`packages/lib/src/server/middleware/auth.ts` (~168 lines)
`packages/core/src/services/session/index.ts` (~119 lines)
`packages/core/src/services/auth-flows/magic-link.ts` (~78 lines)
`packages/core/src/services/auth-flows/ipa.ts` (~88 lines)
`packages/core/src/api/auth.ts` (~175 lines)

Authentication middleware, session management, and login flows.

---

## Findings

### AS-01 | high | Email enumeration via `requiresPassword` flag in magic link flow

**Impact:** An attacker can distinguish IPA accounts from non-existent accounts.

`auth-flows/magic-link.ts:14` returns `{ requiresPassword: true }` when the submitted email belongs to an IPA user. This reveals account existence and provider type. The `auth.ts` comment says "don't leak user existence" but this response contradicts that intent.

**Files:** `auth-flows/magic-link.ts:14`, `api/auth.ts:137` (comment)

---

### AS-02 | medium | Full user load on every authenticated request

**Impact:** Performance -- every request triggers a DB query with recursive CTEs via `accounts.users.get()`.

`auth.ts:51` calls `accounts.users.get({ id: data.userId })` for every authenticated request. There is no caching layer. For high-traffic endpoints, this is a significant bottleneck. The `get()` function runs 4 correlated subqueries with 2 recursive CTEs.

**Files:** `lib/server/middleware/auth.ts:51`

---

### AS-03 | medium | `session.create` always updates `last_login_local` regardless of provider

**Impact:** IPA login timestamps appear as "local" login times.

`session/index.ts:72` updates `last_login_local` for all logins including IPA password logins. The column name implies local-only tracking, but it tracks all web logins. This creates confusion in the admin UI where `last_login_local` is shown alongside `last_login_ipa`.

**Files:** `session/index.ts:72`

---

### AS-04 | medium | User ID embedded in session token

**Impact:** Information leakage -- session token format `userId:randomToken` exposes the UUID.

`session/index.ts:74` creates tokens as `{userId}:{randomUUID}`. Anyone who can observe the cookie or Authorization header learns the user's UUID. A single opaque token would be more secure.

**Files:** `session/index.ts:74`

---

### AS-05 | medium | Magic link auto-creates guest accounts for unknown emails

**Impact:** Anyone with a valid email can create a guest account by requesting a magic link.

`auth-flows/magic-link.ts:19` creates a token even if no user exists. During verification (line 64), a guest account is auto-created. This is likely intentional onboarding behavior but is a significant policy decision embedded in code without configuration.

**Files:** `auth-flows/magic-link.ts:19, 64`

---

### AS-06 | low | `POST /change-password` has no per-username rate limiting

**Impact:** Brute-force risk against known usernames.

`api/auth.ts:80-115` accepts username + passwords without session requirements. The global rate limit applies but a targeted brute-force against a specific username is not specifically throttled.

**Files:** `api/auth.ts:80-115`

---

### AS-07 | low | `POST /logout` has no auth check

**Impact:** Any request can trigger a logout call. Mostly harmless since it just deletes the session cookie.

`api/auth.ts:63-78` is documented with `...requiresAuth` (OpenAPI only) but has no actual auth middleware. Unauthenticated requests trigger a Redis delete for a non-existent session.

**Files:** `api/auth.ts:63-78`

---

### AS-08 | low | Race condition in magic link verification for new users

**Impact:** Concurrent verifications for the same email could produce a constraint violation.

`auth-flows/magic-link.ts:51-70` checks "no user found" then creates a guest. If two tokens for the same email are verified concurrently, both could pass the check and attempt `createGuest`. The second would fail with a unique constraint violation.

**Files:** `auth-flows/magic-link.ts:51-70`

---

### AS-09 | low | Stale sessions not cleaned up when user is deleted between session data load and user load

**Impact:** Redis accumulates orphaned session keys.

`auth.ts:48-58`: if the user is deleted between `session.getData` and `accounts.users.get`, the function returns `{ token, user: null }` and treats the request as unauthenticated. But the stale session in Redis is not cleaned up.

**Files:** `lib/server/middleware/auth.ts:48-58`

---

### AS-10 | low | No session sliding expiry

**Impact:** Active users are logged out after the fixed TTL regardless of activity.

The session TTL is set at creation time (`session/index.ts:68`) and never refreshed. A user active for longer than `expiry_hours` is silently logged out. Consider a sliding window where activity extends the session.

**Files:** `session/index.ts:68`

---

## Open Questions / Assumptions

1. Should the `requiresPassword` response be removed to prevent email enumeration?
2. Is auto-guest-creation on magic link intentional and should it be configurable?
3. Should session tokens use a single opaque format instead of embedding the user ID?
4. Should `last_login_local` be renamed to `last_login_web` to reflect its actual semantics?

## Conclusion

The auth/session layer is functionally correct and secure for the core login flows. The main concerns are: email enumeration via the magic link flow (AS-01), performance of the per-request full user load (AS-02), the `last_login_local` semantic mismatch (AS-03), and information leakage in the token format (AS-04). The auto-guest-creation policy (AS-05) is a significant design decision that should be explicitly documented and ideally configurable.
