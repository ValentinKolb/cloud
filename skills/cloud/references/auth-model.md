# Auth Model — Detailed Reference

## User Storage

Users live in `auth.users`. Key columns from the migration (`packages/core/src/migrate/core/auth.ts`):

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key (auto-generated) |
| `uid` | text | Unique username (FreeIPA `uid` or local username) |
| `provider` | text | `'ipa'` or `'local'` (CHECK constraint) |
| `profile` | text | `'user'` or `'guest'` (CHECK constraint) |
| `given_name`, `sn` | text | First/last name |
| `display_name` | text | Computed or custom display name |
| `mail` | text | Email address (nullable) |
| `admin` | boolean | Direct admin flag (constraint: only `local/user` can be admin) |
| `account_expires` | timestamptz | General expiry date |
| `last_login_local` | timestamptz | Last local login time |
| `created_at` | timestamptz | Account creation time |

Indexes: `idx_users_provider_mail` (unique, on `provider, mail` where mail is not null), `idx_users_provider_profile`, `idx_users_account_expires` (where not null), `idx_users_mail` (where not null).

IPA-specific attributes are stored separately in `auth.user_ipa_data`:

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | UUID | Primary key, FK to `auth.users` |
| `uid_number` | integer | POSIX UID (nullable) |
| `phone` | text | Phone number (nullable) |
| `employee_type` | text | Employee type (nullable) |
| `mobile` | text | Mobile number (nullable) |
| `addr_street` | text | Street address (nullable) |
| `addr_postal_code` | text | Postal code (nullable) |
| `addr_city` | text | City (nullable) |
| `addr_state` | text | State (nullable) |
| `ipa_password_expires` | timestamptz | IPA password expiry (nullable) |
| `last_login_ipa` | timestamptz | Last FreeIPA login (nullable) |
| `synced_at` | timestamptz | Last sync timestamp (nullable) |
| `ssh_public_keys` | text[] | SSH public keys |
| `ssh_fingerprints` | text[] | SSH fingerprints |

**Public contract fields** (in `UserSchema` from `@valentinkolb/cloud/contracts`) use camelCase and slightly different names: `givenname`, `sn`, `displayName`, `accountExpires`, `lastLoginLocal`, `memberofGroup`, `memberofGroupIds`, `manages`, `managesGroupIds`.

## FreeIPA Integration

FreeIPA is the authoritative source for IPA users and groups. The cloud syncs data from FreeIPA to PostgreSQL for fast queries.

### Sync Flow

1. Service account authenticates via `POST /ipa/session/login_password`
2. JSON-RPC calls to `/ipa/session/json` (API v2.251) fetch users and groups
3. Users/groups are upserted into `auth.users` / `auth.groups`
4. Group memberships synced to junction tables

### Login Flow (IPA User)

1. User submits credentials → `POST /ipa/session/login_password`
2. FreeIPA validates → returns `ipa_session` cookie (or `password-expired` rejection via `X-IPA-Rejection-Reason` header)
3. Cloud syncs user data from FreeIPA to local DB
4. Cloud creates Redis session: `session:{userId}:{randomToken}` with TTL, **including the FreeIPA session cookie** (`ipa_session`) in the session data
5. Sets `session_token` cookie: `{userId}:{randomToken}`

### Login Flow (Local User)

1. User submits email → `POST /email-login` sends a magic link with a time-limited token (5 min TTL, stored in Redis as `email-login:{token}`)
2. User clicks the link → `POST /verify-token` validates the token
3. If user doesn't exist and `user.allow_self_registration` is enabled, a guest account is auto-created
4. Cloud creates Redis session (same structure as IPA flow, but `ipaSession` is `null`)

## Role Derivation

Roles are computed by `buildRoles()` in `packages/cloud/src/services/accounts/authz.ts`:

**Always added:**
- `profile` — `"user"` or `"guest"`
- `provider` — `"ipa"` or `"local"`
- `"{provider}/{profile}"` — compound role (e.g. `"ipa/user"`)

**Guest profiles return early** — they cannot receive admin or group-manager roles.

**For non-guest profiles:**
- `"admin"` — if `admin` flag is true
- `"group-manager"` — if user manages at least one group

**Other roles in the schema:**
- `"authenticated"` — special middleware role, not stored in the roles array; checked implicitly by `auth.requireRole("authenticated")`
- `"*"` — special middleware role meaning "load user if present but don't require auth"
- `"anonymous"` — special middleware role meaning "only non-logged-in users"

**Profile derivation:**
- **IPA users**: Profile is **automatically derived** from group membership. If the user belongs to any group in the `freeipa.groups.base_ipa_realm` setting (default: `"cloud"`), they get profile `"user"`, otherwise `"guest"`. The profile is recalculated on every group change.
- **Local users**: Profile is **manually set** by admins and stored permanently in the database. Attempting to change an IPA user's profile directly returns an error.

**Note:** FreeIPA is optional. The platform works without it using local-only accounts and magic link login — useful for development.

### Admin Resolution

Admin status comes from two sources (OR logic):
1. `admin` column in `auth.users` (set manually or during account creation)
2. Membership in any group listed in the `freeipa.groups.admin` setting (default: `["admins"]`)

Note: The admin constraint enforces `admin = false` unless `provider = 'local' AND profile = 'user'`. IPA admin status is derived from group membership.

## Group Model

Groups live in `auth.groups`. Primary key is `id` (UUID):

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key (auto-generated) |
| `cn` | text | FreeIPA common name (NOT NULL, UNIQUE) |
| `provider` | text | `'ipa'` or `'local'` (CHECK constraint) |
| `name` | text | Display name (UNIQUE per provider) |
| `description` | text | Optional |
| `gid_number` | int | POSIX GID (optional, IPA only) |
| `synced_at` | timestamptz | Last sync timestamp |

### Relationships

- `auth.user_groups_v2` — user ↔ group membership (`user_id UUID`, `group_id UUID`)
- `auth.group_groups_v2` — group ↔ group hierarchy (`parent_group_id UUID`, `child_group_id UUID`)
- `auth.group_manager_users_v2` — user manages group (`user_id UUID`, `group_id UUID`)
- `auth.group_manager_groups_v2` — group manages group (`manager_group_id UUID`, `group_id UUID`)

Database triggers enforce provider-safe relations (IPA groups can only contain IPA entities, etc.).

### Transitive Queries

Group queries support recursive traversal via PostgreSQL recursive CTEs:
- `getMembers(groupId, recursive?)` — all direct + transitive members
- `getManagers(groupId, recursive?)` — all direct + transitive managers
- `getParents(groupId, recursive?)` — all ancestor groups

## Session Management

Sessions are stored in Redis:

- **Key**: `session:{userId}:{randomToken}`
- **Value**: JSON `{ userId: string, ipaSession: string | null, gen: number }`
- **TTL**: Configurable via `user.session.expiry_hours` setting

`gen` is the user's session-generation counter at the time the session was created. `session.revokeAllForUser(userId)` is an atomic INCR on a separate `session:gen:{userId}` key — any stored session whose `gen` is below the current counter is rejected at lookup time without touching the session key itself.

Token extraction priority:
1. Cookie: `session_token`
2. Bearer header: `Authorization: Bearer {token}`

Token format: `{userId}:{randomToken}` — both parts needed to look up the session.

## Access Control

The platform uses a **principal-based access model** via `auth.access`. This is NOT a simple resource/entity table — it works through the `ResourceAccessAdapter` pattern.

### auth.access Table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Nullable, references `auth.users` (ON DELETE CASCADE) |
| `group_id` | UUID | Nullable, references `auth.groups(id)` (ON DELETE CASCADE) |
| `authenticated_only` | boolean | Grant to any authenticated user |
| `permission` | enum | `'none'`, `'read'`, `'write'`, `'admin'` |
| `created_at` | timestamptz | When this entry was created |

A principal check constraint ensures at most one of `user_id`, `group_id`, or `authenticated_only` is set. Public access entries have all three unset/false.

### Principal Types

```typescript
type Principal =
  | { type: "user"; userId: string }
  | { type: "group"; groupId: string }
  | { type: "authenticated" }       // any logged-in user
  | { type: "public" }              // no auth required
```

### ResourceAccessAdapter Pattern

Apps don't query `auth.access` directly. Instead, they create app-specific junction tables linking resources to access entries, and implement a `ResourceAccessAdapter`:

```typescript
type ResourceAccessAdapter<TResourceId = string> = {
  list: (resourceId: TResourceId) => Promise<AccessEntry[]>;
  add: (resourceId: TResourceId, accessId: string) => Promise<Result<void>>;
  remove: (resourceId: TResourceId, accessId: string) => Promise<Result<void>>;
  count: (resourceId: TResourceId) => Promise<number>;
};
```

The server package provides helpers: `createAccess`, `getAccess`, `updateAccess`, `deleteAccess`, `getEffectivePermission`, `listUsersWithAccess` — all importable from `@valentinkolb/cloud/server`.

`getEffectivePermission()` resolves the highest permission level across all matching principals (direct user, group memberships, authenticated-only, public).

`listUsersWithAccess()` is for bounded "people with access" tasks such as assignee pickers. Apps pass the relevant `auth.access` IDs from their own `ResourceAccessAdapter`; the helper expands direct users and recursive group memberships, returns the top-level source group for group-derived users, and deliberately does not expand `public` or `authenticated` entries. Its return shape omits `mail`; use `uid`, `displayName`, `permission`, and `source` for UI labels and validation.

See the `contacts` app for a real-world permissions implementation.

**Example: Contacts app access control**

1. Junction table linking contact books to access entries:

```sql
CREATE TABLE IF NOT EXISTS contacts.book_access (
  book_id UUID NOT NULL REFERENCES contacts.books(id) ON DELETE CASCADE,
  access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, access_id)
);
```

2. Check permission in a route handler:

```typescript
import { getEffectivePermission, hasPermission } from "@valentinkolb/cloud/server";

// Load access IDs for this book
const entries = await bookAccess.list(bookId);
const accessIds = entries.map((e) => e.id);

// Resolve highest permission for the current user
const permission = await getEffectivePermission({
  accessIds,
  userId: user.id,
  userGroups: user.memberofGroupIds,
});

if (!hasPermission(permission, "read")) {
  return c.json({ message: "Forbidden" }, 403);
}
```

## Audit Events

Security-relevant account and identity mutations are recorded in `audit.events`.
This is the Cloud-owned audit trail for Accounts admin operations, self-service
account changes, account requests, and service-layer authorization denials.

Storage is plain PostgreSQL by default:

| Column group | Notes |
|--------------|-------|
| `created_at`, `action`, `outcome` | When it happened, stable action id, and `allowed` / `denied` / `failed` |
| `actor_*` | Acting Cloud user id, uid, provider, and roles where available |
| `target_*` | Target resource type/id/label/provider where available |
| `reason`, `error_*`, `request_id` | Human-readable denial/failure context and request correlation |
| `metadata` | Small JSONB payload with non-secret operational context |

TimescaleDB can be enabled in production for retention/analytics, but local
development must not require it. Core migrations should attempt optional
Timescale setup defensively and continue on plain Postgres when the extension is
not available.

Audit writes must be performed from services, not only from HTTP routes. The
service layer owns the decision and records both allowed and denied outcomes.
Never write passwords, raw tokens, raw cookies, raw `ipa_session` values, or
full sensitive request payloads to audit metadata. Use the shared audit
sanitizer and pass minimal metadata such as changed field names, provider,
request id, or booleans like `notificationSent`.

For Accounts specifically, keep double enforcement while the FreeIPA subsession
migration is still in progress:

- Cloud service-layer checks run first for admin, self-service, and
  group-manager mutations.
- Existing HTTP-route checks remain as defense-in-depth.
- Existing FreeIPA session/permission behavior remains until a reviewed follow-up
  removes stored `ipaSession` from Cloud sessions.
- Admin UI should expose a searchable `DataTable` audit page with URL-backed
  filters for actor, target, action, outcome, provider, and time range.

## Account Lifecycle

The platform manages account expiry automatically:

| Setting | Controls |
|---------|----------|
| `user.account.ipa_expires_days` | Days until IPA accounts expire (default: 365) |
| `user.account.local_user_expires_days` | Days until local user accounts expire (default: 0 = no expiry) |
| `user.account.local_guest_expires_days` | Days until guest accounts expire (default: 365) |
| `user.account.reminder_days` | Days before expiry to send reminder (default: `[30, 7]`) |
| `freeipa.account_transition_policy` | What happens on IPA expiry: `"delete"`, `"demote_to_local"`, `"demote_to_local_guest"`, `"demote_to_local_user"` |

Lifecycle jobs run on a cron schedule:
- `demoteExpiredIpaUsers()` — delete or demote expired IPA accounts per transition policy
- `cleanupExpiredGuests()` — delete expired guest accounts
- `sendExpiryReminders()` — send email reminders before expiry
- `extendCurrentUserAccount()` — user self-service extension

Deleted accounts are archived to `auth.deleted_accounts` for audit:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `deleted_user_id` | UUID | ID of the deleted user (NOT NULL) |
| `uid` | text | User's uid (NOT NULL) |
| `mail` | text | Email (nullable) |
| `display_name` | text | Display name (nullable) |
| `previous_provider` | text | Provider before deletion (nullable) |
| `previous_profile` | text | Profile before deletion (nullable) |
| `reason` | text | Deletion reason (NOT NULL, CHECK constraint) |
| `deleted_at` | timestamptz | When deleted |
| `meta` | JSONB | Additional metadata |

Valid `reason` values: `'ipa_expired_demoted'`, `'ipa_expired_deleted'`, `'sync_out_of_scope_demoted'`, `'sync_out_of_scope_deleted'`, `'guest_expired_deleted'`, `'local_user_expired_deleted'`, `'manual_delete'`, `'manual_demote'`.

Indexes: `idx_deleted_accounts_deleted_at` (DESC), `idx_deleted_accounts_reason`, `idx_deleted_accounts_uid`, `idx_deleted_accounts_deleted_user_id`.

### Account Requests

Users can request account upgrades or access. Tracked in `auth.account_requests`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK to `auth.users`, nullable (ON DELETE CASCADE) |
| `phone` | text | Contact phone (nullable) |
| `comment` | text | Request comment (nullable) |
| `accepted_agb` | boolean | Terms of service accepted |
| `status` | text | `'pending'`, `'completed'`, `'denied'` (CHECK constraint) |
| `denied_reason` | text | Reason for denial (nullable) |
| `processed_at` | timestamptz | When processed (nullable) |
| `processed_by` | UUID | FK to `auth.users` (ON DELETE SET NULL), who processed (nullable) |
| `created_at` | timestamptz | Request creation time |

### Account Lifecycle Reminders

Expiry reminders are tracked in `auth.account_lifecycle_reminders`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK to `auth.users` (ON DELETE SET NULL) |
| `kind` | text | Reminder type (NOT NULL) |
| `threshold_days` | integer | Days-before-expiry threshold |
| `target_expiry_at` | timestamptz | The expiry date being warned about |
| `uid` | text | Snapshot of user's uid |
| `mail` | text | Snapshot of user's email |
| `display_name` | text | Snapshot of display name |
| `status` | text | `'pending'`, `'sent'`, etc. |
| `attempt_count` | integer | Number of send attempts |
| `last_attempt_at` | timestamptz | Last send attempt (nullable) |
| `sent_at` | timestamptz | When successfully sent (nullable) |
| `last_error` | text | Last error message (nullable) |
| `created_at` | timestamptz | When reminder was created |

## Auth Middleware Reference

```typescript
import { auth } from "@valentinkolb/cloud/server";

// Basic role checks (OR logic — any listed role grants access)
auth.requireRole("authenticated")              // any logged-in user
auth.requireRole("admin")                      // admin only
auth.requireRole("admin", "group-manager")     // admin OR group-manager
auth.requireRole("*")                          // load user if present, don't require auth
auth.requireRole("anonymous")                  // only non-logged-in users

// With rejection handler (pass as last argument)
auth.requireRole("admin", auth.redirect("/"))          // redirect on rejection
auth.requireRole("authenticated", auth.redirectToLogin) // redirect to login with ?redirectTo

// Account type filter
auth.requireAccount({ provider: "ipa" })              // IPA users only
auth.requireAccount({ provider: "local", profile: "user" }) // local full accounts only

// Access in handlers
const user = c.get("user");        // Full User object
const token = c.get("sessionToken"); // Session token string
```

## Design Principles & Rationale

Why the auth/accounts system looks the way it does. Keep in mind when
extending it — the choices below are load-bearing.

1. **FreeIPA is the single source of truth** for IPA users. The local
   `auth.*` tables are a mirror for fast queries. On conflict, FreeIPA wins;
   `syncUser()` returns a typed outcome so stale mirror state never grants a
   fresh session (see `packages/cloud/src/services/ipa/sync.ts`).

2. **Auth / sessions / account lifecycle are core, not app code.** Every
   container shares the same user, role, and session model. A new login flow
   or role type is a core change; apps consume but never define these
   primitives.

3. **The `accounts` app is pure admin UI.** It owns no schema, no service
   logic, no auth flows — just thin HTTP wrappers and admin pages on top of
   `@valentinkolb/cloud/services`. A user can fork or replace it without
   touching auth semantics. This is why `/me/*` lives in core, not in
   accounts.

4. **HTTP topology follows owner + consumer:**
   - `/api/auth/*` — session-making (anonymous until authed)
   - `/api/me/*` — self-service (any logged-in user)
   - `/api/admin/account-lifecycle/*` — platform operators (admin role)
   - `/api/accounts/*` — admin UI for managing third parties

5. **REST conventions across these surfaces:**
   - `PUT` for field replacement (`/users/:id/{admin,profile,provider,expiry}`, `/groups/:id/posix`)
   - `POST` for resource creation, including generative actions
     (`password-reset`, `login-link`, `login-token`, `notifications`,
     `demotion`, `account-extension`)
   - `DELETE` only for actual removal — no `?mode=` query params
   - Jobs: one `POST /admin/lifecycle/jobs` with a `kind` discriminator,
     rather than one RPC verb per job

6. **Session revocation is a generation counter**, not a SCAN+DEL over Redis
   keys. `session.revokeAllForUser(userId)` is an atomic INCR; every session
   records the counter at creation and is rejected if it falls behind. This
   makes revocation race-free against concurrent logins.

7. **Partial vs full mirror writes are separate primitives.** IPA profile
   patches use `patchUserIpaData` (COALESCE per column); full sync uses
   `upsertUserIpaData` (destructive replace). Conflating them once wiped
   SSH keys on every profile edit.

8. **Self-service account deletion is guest-only.** Destructive lifecycle
   controls on full accounts always require another admin, so an admin can
   never remove their own expiry or demote themselves (enforced by
   `preventSelfDestructiveAction` in the accounts API).
