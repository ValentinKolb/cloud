# Auth, principals, and access control

Everything here is core-owned. Apps consume this model; they never redefine it.

If you only need to protect a route and check a resource permission, read *Middleware* and *Resource access* and stop. The rest is for working on core itself.

## User types

Four combinations of provider and profile:

| Provider | Profile | Meaning |
|---|---|---|
| `ipa` | `user` | Full Kerberos account managed in FreeIPA |
| `ipa` | `guest` | FreeIPA account in sync scope but outside the configured full-user realm |
| `local` | `user` | Cloud-managed full account in Postgres |
| `local` | `guest` | Cloud-managed visitor account, usually auto-expiring |

Provider and profile describe **account ownership and authorization**, not login method. Local users have no password: they sign in by magic link, and by passkey after enrolling one on `/me`. IPA users authenticate against FreeIPA and may also enrol Cloud passkeys.

**Admin token login.** When `ADMIN_LOGIN_TOKEN` is set, `/auth/login?method=admin` accepts that token in a single field and auto-creates a `local|user` admin account with uid `admin`. Internally it is an ordinary local user — only the login mechanism differs. Development only.

FreeIPA is optional. The platform runs on local accounts and magic-link login alone.

## Roles

Roles are **computed** by `buildRoles()` from provider, profile, group memberships, and the admin flag. They are not stored as a list.

- `user` / `guest` — profile-based, always present
- `ipa` / `local` — provider-based, always present
- `ipa/user`, `ipa/guest`, `local/user`, `local/guest` — compound, always present
- `admin` — local admin flag is true, **or** an IPA user is effectively in an admin group
- `group-manager` — manages at least one group

Guest profiles return early: a guest can never be `admin` or `group-manager`.

Three role strings are middleware-only and never appear in the array: `authenticated` (any resolved actor), `*` (load the user if present, do not require), and `anonymous` (only non-logged-in).

For IPA users, profile is derived by full sync from `auth.ipa_user_effective_groups`: effective membership in `freeipa.groups.base_ipa_realm` yields `user`; membership in `freeipa.groups.base_sync` without the base realm yields `guest`. Local profiles are set by admins and stored. Changing an IPA user's profile directly is an error.

Admin resolution is an OR: the `admin` column, or effective IPA membership in `freeipa.groups.admin`. A database constraint enforces `admin = false` unless the account is `local/user`.

## Middleware

```typescript
import { auth } from "@valentinkolb/cloud/server";

auth.requireRole("authenticated")               // any logged-in actor
auth.requireRole("admin")                       // admin only
auth.requireRole("admin", "group-manager")      // OR logic
auth.requireRole("*")                           // load user if present, do not require
auth.requireRole("anonymous")                   // only non-logged-in

auth.requireRole("admin", auth.redirect("/"))            // rejection handler last
auth.requireRole("authenticated", auth.redirectToLogin)  // adds ?redirectTo

auth.requireAccount({ provider: "ipa" })
auth.requireAccount({ provider: "local", profile: "user" })
```

`requireRole("authenticated")` accepts any resolved actor. A concrete role check such as `requireRole("admin")` requires a **user-backed** actor, so a resource-bound service account is rejected unless the route does its own explicit resource permission check.

## RequestActor and AccessSubject

This is the part most app code gets wrong. Every authenticated request resolves to two related things:

```typescript
type RequestActor =
  | { kind: "user"; user: User }
  | { kind: "service_account"; serviceAccount: ServiceAccount; delegatedUser: User | null };

type AccessSubject =
  | { type: "user"; userId: string }
  | { type: "service_account"; serviceAccountId: string };
```

`RequestActor` answers *which credential acted*. `AccessSubject` answers *whose grants should be checked*.

| Caller | actor.kind | accessSubject | Notes |
|---|---|---|---|
| Browser session | `user` | `{ type: "user" }` | Same user for both |
| User-bound API key, user-delegated service account | `service_account` + `delegatedUser` | `{ type: "user" }` | Behaves as the linked user, with that user's live roles and grants |
| Resource-bound API key, OAuth client-credentials token | `service_account` | `{ type: "service_account" }` | **No user.** Permissions come only from explicit service-account grants |

```typescript
const actor = c.get("actor");                 // which credential acted
const accessSubject = c.get("accessSubject"); // whose grants to check
const token = c.get("sessionToken");          // browser session token, if cookie/session auth
```

### There is no `c.get("user")`

Before service accounts existed, the middleware resolved a request to one thing: a `User`. That variable is gone from app code — `check:boundaries` fails on it — because it cannot express a caller that has no user, and because it was typed `User` while being `undefined` for a resource-bound principal. Code written against it compiled, passed review, and silently excluded every API key.

When a feature genuinely needs the user — roles, display name, avatar — derive it **from the actor**:

```typescript
import { expectUserBackedActor, userFromActor } from "@valentinkolb/cloud/server";

const user = expectUserBackedActor(c);   // throws; for routes already gated to a user-backed role
const maybe = userFromActor(c.get("actor")); // User | null
```

The user stays reachable. What is no longer possible is reaching it *without* the credential context — which is what silently disabled a scope cap in one app and pushed a session token into page HTML in another.

**For authorization, do not derive a user at all.** Pass `c.get("accessSubject")` into the shared access helpers: it already normalises a user-bound credential to its user, which is the whole point. A user-bound API key **is** that user and must behave identically everywhere.

The same split runs through the whole API surface. When a helper offers both shapes, the one taking `subject`/`accessSubject` is the current one — see `getEffectivePermission` below, whose `userId`, `serviceAccountId`, and `userGroups` parameters are all deprecated.

## Bearer token resolution

Authentication resolves in a fixed order:

1. Cookie session (`session_token`)
2. `cld_<prefix>_<secret>` API keys, via `serviceAccountCredentials`
3. Any other Bearer token, as an OAuth access token

OAuth access tokens are verified with the OAuth app's current signing key, issuer derived from `app.url`, audience `"cloud"`, and `token_use = "access"`. User authorization-code tokens resolve to `actor.kind = "user"`; client-credentials tokens bound to a resource service account resolve to `actor.kind = "service_account"` with `delegatedUser = null`.

OAuth scopes are **limiting metadata on the credential**. They never grant permission by themselves — the app still resolves access through `AccessSubject` and its own resource grants.

## Sessions

Redis-backed, keyed `session:{userId}:{randomToken}`, value `{ userId, gen }`, TTL from the `user.session.expiry_hours` setting. The cookie and Bearer token format is `{userId}:{randomToken}`; both halves are needed for lookup.

`gen` is the user's session-generation counter at creation time. `session.revokeAllForUser(userId)` is an atomic `INCR` on a separate `session:gen:{userId}` key — any session whose stored `gen` falls behind is rejected at lookup without touching the session key. This makes revocation race-free against concurrent logins.

The FreeIPA `ipa_session` cookie is **never** stored in a Cloud session.

## Resource access

The platform uses a principal-based model in `auth.access`. Apps never query that table directly.

```typescript
type Principal =
  | { type: "user"; userId: string }
  | { type: "group"; groupId: string }
  | { type: "service_account"; serviceAccountId: string }
  | { type: "authenticated" }   // any logged-in user
  | { type: "public" };         // no auth required
```

Permission levels are ordered: `none` < `read` < `write` < `admin`.

### The pattern

1. Create a junction table linking your resource to `auth.access`:

```sql
CREATE TABLE IF NOT EXISTS my_app.item_access (
  item_id   UUID NOT NULL REFERENCES my_app.items(id) ON DELETE CASCADE,
  access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, access_id)
);
```

2. Implement a `ResourceAccessAdapter`:

```typescript
type ResourceAccessAdapter<TResourceId = string> = {
  list:   (resourceId: TResourceId) => Promise<AccessEntry[]>;
  add:    (resourceId: TResourceId, accessId: string) => Promise<Result<void>>;
  remove: (resourceId: TResourceId, accessId: string) => Promise<Result<void>>;
  count:  (resourceId: TResourceId) => Promise<number>;
};
```

3. Resolve the permission — pass the request's `accessSubject` straight through:

```typescript
import { getEffectivePermission, hasPermission } from "@valentinkolb/cloud/server";

const entries = await itemAccess.list(itemId);

const permission = await getEffectivePermission({
  accessIds: entries.map((entry) => entry.id),
  subject: c.get("accessSubject"),
});

if (!hasPermission(permission, "write")) {
  return c.json({ message: "Forbidden" }, 403);
}
```

`subject` is the current parameter. `getEffectivePermission` also still accepts `userId`, `serviceAccountId`, and `userGroups`, but those are **deprecated** — and `userGroups` is ignored outright, because nested membership is resolved authoritatively from the auth tables. Passing group ids from a `User` object silently does nothing.

> **Never authorize from `User.memberofGroupIds`.** It is projection metadata for display, not an access input. Nested memberships must behave exactly like direct ones, and only the shared helpers guarantee that.

To filter a list query rather than check one resource, use `buildAccessPrincipalCondition()` — same semantics, expressed as a SQL condition.

### Principal matching rules

- an anonymous request matches `public` entries;
- a **user** subject matches direct user entries, direct *and recursively nested* group entries, `authenticated`, and `public`;
- a **resource-bound service account** matches its explicit service-account entries, `authenticated`, and `public`;
- a **user-delegated** service account acts only as its delegated user. Never union the service account's own grants with the user's.

For a resource-bound service account the app must additionally verify the exact `appId`, `resourceType`, and `resourceId` before loading data, and take the **lower** of the resolved permission and the credential scope. Collection and search endpoints fail closed or restrict the query to that exact resource.

### Listing people with access

`listUsersWithAccess()` covers bounded "who can I assign this to" tasks. Pass the access ids from your own adapter; do not query `auth.users` or the group junction tables directly for this.

```typescript
const users = await listUsersWithAccess({
  accessIds: entries.map((entry) => entry.id),
  search: query.search,
  excludeUserIds: currentAssigneeIds,
  minimumPermission: "read",
  limit: 20,
});
```

It expands direct grants and group grants recursively. The returned `source` is deterministic: direct grants give `{ type: "direct" }`; group-derived users give the **top-level** group from the grant, not the nested child group that happened to contain the user. It deliberately does *not* expand `public` or `authenticated` — those are valid for permission checks but not predictable candidate lists. The shape is `id`, `uid`, `displayName`, `permission`, `source`; it does not expose `mail`.

## Service accounts and API keys

- **User-bound** keys live in core self-service (`/me`) and inherit the linked user's effective permissions. Core creates or reuses one user-delegated service account named `Personal API keys`, stores only the hash, and returns the raw token once.
- **Resource-bound** keys belong to one app resource. They authenticate as a `service_account` principal and work only where the app has granted that service account access.
- OAuth `client_credentials` tokens use the same principal model. The difference is issuance: short-lived JWTs from the OAuth app versus long-lived hashed `cld_<prefix>_<secret>` credentials in core.

`auth.service_accounts`, `auth.service_account_credentials`, and `auth.access` are platform-owned. Apps create only their own resource/access junction tables.

Revoking a credential stops that secret from authenticating. It does **not** remove the service account or its resource grant — keep secret lifecycle and permission lifecycle separate unless the user explicitly asks for cleanup.

Full backend and UI flow: `api-keys.md`.

## Groups

`auth.groups` is keyed by UUID `id`, with `cn` unique per FreeIPA convention and `name` unique per provider. Relations:

| Table | Links |
|---|---|
| `auth.user_groups_v2` | user ↔ group membership |
| `auth.group_groups_v2` | group ↔ group hierarchy |
| `auth.group_manager_users_v2` | user manages group |
| `auth.group_manager_groups_v2` | group manages group |
| `auth.ipa_user_effective_groups` | full graph-derived IPA user ↔ group names, including excluded groups |

Database triggers enforce provider-safe relations — an IPA group cannot contain local entities.

`getMembers(groupId, recursive?)`, `getManagers(groupId, recursive?)`, and `getParents(groupId)` traverse the hierarchy with recursive CTEs.

`freeipa.groups.excluded` hides groups from the **display** graph only. Excluded groups still count for effective scope, profile, and admin calculation, and traversal through a nested excluded group must still work.

## FreeIPA sync

FreeIPA is the single source of truth for IPA users; the local `auth.*` tables are a mirror for fast queries.

Full sync authenticates the service account, fetches users and groups over JSON-RPC, upserts them, and projects the **full group graph** into `auth.ipa_user_effective_groups`. That projection — not user-side `memberof*` — decides sync scope, profile, and admin state. User-side `memberof*` is drift telemetry only.

Single-user sync at login does not destructively change scope or profile. It uses the last full-sync projection and logs drift when FreeIPA's user attributes disagree with the group graph.

Directory mutations run through the configured FreeIPA service account *after* Cloud service-layer authorization and audit checks pass. That account needs explicit FreeIPA role membership for the mutations Cloud performs — see `ops.md`. The only intentional user-session FreeIPA cookie is the fresh credential verification inside `changeOwnPassword()`.

Partial and full mirror writes are separate primitives: profile patches use `patchUserIpaData` (COALESCE per column), full sync uses `upsertUserIpaData` (destructive replace). Conflating them once wiped every user's SSH keys on a profile edit.

## Passkeys

Cloud-owned WebAuthn credentials bound to `auth.users.id` — not FreeIPA passkeys. They work for local and IPA users, full users and guests, and produce the same session shape as any other browser login.

RP configuration comes from runtime settings: `app.url` supplies `origin` and `rpID`, `app.name` the display name. `app.url` must be HTTPS outside localhost.

`auth.webauthn_credentials` stores public material only — credential id, public key, counter, transports, device type, backup state, name, timestamps. Private keys never leave the authenticator. Challenges live in Redis with a short TTL and are consumed once.

Registration uses resident keys with required user verification, `attestationType: "none"`, and excludes credentials already registered for the account. Keep protocol validation inside the SimpleWebAuthn libraries; Cloud owns only RP config, challenge persistence, account lookup, expiry checks, audit, and storage.

## Account lifecycle

| Setting | Controls |
|---|---|
| `user.account.ipa_expires_days` | IPA account expiry (default 365) |
| `user.account.local_user_expires_days` | Local user expiry (default 0 = never) |
| `user.account.local_guest_expires_days` | Guest expiry (default 365) |
| `user.account.reminder_days` | Days before expiry to remind (default `[30, 7]`) |
| `freeipa.account_transition_policy` | On IPA expiry or leaving `base_sync`: `delete`, `demote_to_local`, `demote_to_local_guest`, `demote_to_local_user` |

Scheduled jobs handle demotion of expired IPA users, cleanup of expired guests, and expiry reminders.

Self-service IPA extension is **fail-closed**: before touching FreeIPA, Cloud rebuilds the current group graph, requires effective membership in `freeipa.groups.base_sync`, runs a single-user sync, and rechecks the synced expiry. Expired, missing, out-of-scope, or non-expiring accounts are not extended.

Deleted accounts are archived to `auth.deleted_accounts` with a constrained `reason` (`ipa_expired_demoted`, `sync_out_of_scope_deleted`, `guest_expired_deleted`, `manual_delete`, …) for audit.

## Audit

Security-relevant account, identity, and permission mutations go to `audit.events`: timestamp, stable `action` id, `outcome` (`allowed` / `denied` / `failed`), actor and target descriptors, reason and error context, request id, and a small JSONB metadata payload.

Audit writes belong in **services**, not only in routes — the service layer owns the decision and records both allowed and denied outcomes. See `backend.md` for the calling pattern.

Never write passwords, raw tokens, cookies, `ipa_session` values, or full request payloads into audit metadata. Pass changed field names, provider, request id, and booleans.

TimescaleDB can be enabled in production for retention and analytics, but local development must not require it — core migrations attempt the optional setup defensively and continue on plain Postgres.

For FreeIPA-backed mutations, keep double enforcement: service-layer checks first, existing HTTP route checks as defence in depth. IPA group member-managers may add and remove members of groups they manage, but changing the member-manager list itself is an admin operation, matching FreeIPA's own model.

## Why it looks like this

The load-bearing decisions, so you do not undo one by accident:

1. **FreeIPA's group graph wins.** The mirror is for speed. `syncUser()` returns a typed outcome so stale mirror state can never grant a fresh session.
2. **Auth is core, not app code.** Every container shares one user, role, and session model. A new login flow or role type is a core change.
3. **The accounts app is pure admin UI.** It owns no schema and no auth logic, so it can be forked or replaced freely. That is why `/me/*` lives in core.
4. **HTTP topology follows owner plus consumer.** `/api/auth/*` makes sessions, `/api/me/*` is self-service, `/api/admin/account-lifecycle/*` is for operators, `/api/accounts/*` is admin UI for managing third parties.
5. **Session revocation is a generation counter,** not a SCAN and DELETE over Redis keys. Atomic, and race-free against concurrent logins.
6. **Self-service destructive actions stay narrow.** Guest self-delete is allowed; destructive lifecycle control over full accounts stays in admin flows.
