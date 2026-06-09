# FreeIPA Subsession Removal Readiness

This note records the current state after removing stored FreeIPA user
subsessions from Cloud sessions.

## Recommendation

Cloud sessions must not store a human user's FreeIPA `ipa_session`.

FreeIPA-backed directory mutations run through Cloud service-layer
authorization and audit first. If allowed, Cloud executes the FreeIPA RPC with
the configured FreeIPA service account. This keeps Cloud as the authorization
authority while FreeIPA remains the directory backend and operational guardrail.

This is separate from Cloud API/OAuth service accounts. FreeIPA service-account
execution is an internal directory mutation transport; Cloud service accounts
are first-class Cloud principals used by API keys, OAuth service tokens, and
resource access grants.

## Current State

| Area | Current behavior |
|------|------------------|
| Cloud session storage | `packages/cloud/src/services/session/index.ts` stores `{ userId, gen }` only. |
| Login/password-change routes | IPA login still validates credentials through FreeIPA, syncs/loads the local user, then creates a Cloud session without storing `ipa_session`. |
| `/me` profile update | `packages/cloud/src/api/me.ts` calls the Accounts service without session plumbing; the service verifies self-service fields before executing IPA updates with the service account. |
| `/me` account extension | `accountLifecycle.extendCurrentUserAccount()` owns the extension rules, proves current `freeipa.groups.base_sync` membership from FreeIPA `group_find`, runs a single-user IPA sync/freshness check, then uses the service account for IPA expiry updates. Non-expiring, expired, missing, or out-of-scope accounts are not extended. |
| `/me` self-delete | Guest self-delete is authorized in the Accounts service and uses service-account execution for IPA-backed guests. |
| Own password change | `accountsService.user.changeOwnPassword()` verifies the current password with FreeIPA and uses only that fresh verification session for the password change RPC. Do not replace this with service-account execution. |
| Accounts user admin routes | Admin user mutations no longer read `auth.session.getIpaSession()`; service methods obtain a service-account session when the target provider requires FreeIPA. |
| Accounts group routes | Member add/remove supports admins and FreeIPA-style member managers through Cloud authorization. Changing the member-manager list itself is admin-only, matching FreeIPA behavior. |
| IPA Hosts admin routes | Host and hostgroup mutations authorize admin actors in the service layer before acquiring a service-account session. HTTP routes no longer require actor IPA sessions. |
| Low-level IPA providers | `packages/cloud/src/services/ipa/users.ts`, `packages/cloud/src/services/ipa/groups.ts`, and `packages/ipa-hosts/src/backend/provider.ts` still accept caller-provided `ipaSession` as low-level RPC primitives. Callers outside provider/sync/password-change code should use service-layer helpers instead. |

## Service-Account Permissions

The configured FreeIPA service account must be able to perform every directory
mutation that Cloud authorizes:

- user create, modify, delete, and lookup;
- user account-expiry updates;
- admin password reset for users;
- group create, modify, delete, and lookup;
- group POSIX conversion where enabled;
- add/remove user and group members;
- add/remove user and group managers for admin-authorized manager-list changes;
- host modify/delete and hostgroup membership mutations for the IPA Hosts app;
- hostgroup create, modify, delete, and lookup;
- read users, groups, hosts, memberships, and managers for sync and authorization
  context.

These permissions are intentionally broad. Keep the Cloud service facade small,
audited, and tested because Cloud decides whether a requested mutation is
allowed.

### FreeIPA Service Account Setup

Use a dedicated FreeIPA user and role for the Cloud service account. Do not add
the service account to broad human-admin roles such as `User Administrator`,
`IT Specialist`, or `admins`.

Set local shell variables first:

```bash
SA="cloud_service"
ROLE="Cloud Service Account"
```

Create the service account user if it does not exist yet. If your organization
provisions service users elsewhere, create the user there and continue with the
role setup below.

```bash
ipa user-add "$SA" \
  --first="Cloud" \
  --last="Service Account" \
  --homedir="/dev/null" \
  --shell="/sbin/nologin" \
  --password
```

Create the Cloud role:

```bash
ipa role-add "$ROLE" \
  --desc="Service account role for Cloud-managed FreeIPA operations" || true
```

Add account-expiry permissions:

```bash
ipa privilege-add "Cloud User Expiry Management" \
  --desc="Allow Cloud to set and clear IPA user account expiration" || true

ipa privilege-add-permission "Cloud User Expiry Management" \
  --permissions="Modify User Expiration"

ipa role-add-privilege "$ROLE" \
  --privileges="Cloud User Expiry Management"
```

Add Accounts user administration permissions. These are required for IPA user
create, profile updates, admin password reset, user removal, and explicit
expiry changes through the Accounts app.

```bash
ipa privilege-add "Cloud User Management" \
  --desc="Allow Cloud to create, update, remove, and reset IPA users" || true

ipa privilege-add-permission "Cloud User Management" \
  --permissions="System: Add Users" \
  --permissions="System: Modify Users" \
  --permissions="System: Change User password" \
  --permissions="System: Remove Users" \
  --permissions="Modify User Expiration"

ipa role-add-privilege "$ROLE" \
  --privileges="Cloud User Management"
```

Add Accounts group administration permissions. These are required for IPA group
create, edit, delete, and member changes through the Accounts app.

```bash
ipa privilege-add "Cloud Group Management" \
  --desc="Allow Cloud to create, update, remove, and manage IPA group membership" || true

ipa privilege-add-permission "Cloud Group Management" \
  --permissions="System: Add Groups" \
  --permissions="System: Modify Groups" \
  --permissions="System: Remove Groups" \
  --permissions="System: Modify Group Membership"

ipa role-add-privilege "$ROLE" \
  --privileges="Cloud Group Management"
```

Add IPA Hosts permissions. These are required for host metadata updates,
hostgroup membership, and hostgroup create/edit/delete in the IPA Hosts app.

```bash
ipa privilege-add "Cloud Host Management" \
  --desc="Allow Cloud to update IPA host metadata and hostgroup membership" || true

ipa privilege-add-permission "Cloud Host Management" \
  --permissions="System: Modify Hosts" \
  --permissions="System: Modify Hostgroup Membership" \
  --permissions="System: Add Hostgroups" \
  --permissions="System: Modify Hostgroups" \
  --permissions="System: Remove Hostgroups"

ipa role-add-privilege "$ROLE" \
  --privileges="Cloud Host Management"
```

Add the service account to the role:

```bash
ipa role-add-member "$ROLE" --users="$SA"
```

Add `System: Remove Hosts` only when Cloud should be allowed to delete IPA
hosts:

```bash
ipa privilege-add-permission "Cloud Host Management" \
  --permissions="System: Remove Hosts"
```

Verify effective membership:

```bash
ipa role-show "$ROLE" --all --raw
ipa user-show "$SA" --all --raw | grep -Ei "memberof|memberofindirect|uid:"
```

Expected minimum output includes the Cloud role plus indirect membership in:

- `Modify User Expiration`;
- `System: Add Users`, `System: Modify Users`, `System: Change User password`,
  and `System: Remove Users`;
- `System: Add Groups`, `System: Modify Groups`, `System: Remove Groups`, and
  `System: Modify Group Membership`;
- `System: Modify Hosts`;
- `System: Modify Hostgroup Membership`;
- `System: Add Hostgroups`, `System: Modify Hostgroups`, and
  `System: Remove Hostgroups`.

After creating the service account, configure Cloud with the account's FreeIPA
username and password through `freeipa.service_user` and
`freeipa.service_password`.

When the Cloud UI returns `Insufficient access: Insufficient 'write'
privilege to ...`, map the mentioned LDAP attribute or operation back to the
missing FreeIPA permission. For example:

- `krbPrincipalExpiration` → `Modify User Expiration`;
- `nsHostLocation`, `l`, `description`, or `macAddress` → `System: Modify Hosts`;
- hostgroup membership changes → `System: Modify Hostgroup Membership`.
- user create/update/delete/reset flows → the `Cloud User Management`
  permissions above;
- group create/update/delete/member flows → the `Cloud Group Management`
  permissions above.

## Audit Coverage

Covered by the current Accounts service facade:

- admin user mutations, including denied admin/self-protection checks;
- self-service profile/password/self-delete operations;
- account extension lifecycle outcomes;
- group create/update/remove/POSIX operations;
- group member mutations and admin-only manager-list mutations, including denied manager checks;
- account request create/withdraw/deny/complete flows;
- metadata sanitization for passwords, tokens, cookies, and `ipaSession`.

The Accounts admin UI exposes a searchable `DataTable` for actor, target,
action, outcome, provider, and time-range inspection.

## Operational Risks

- A misconfigured service account can turn Cloud authorization bugs into
  directory-wide mutation capability. Keep authorization in services and do not
  let HTTP routes bypass it.
- Manager authorization must compare stable group IDs, not display names.
- FreeIPA service-account helpers are internal service plumbing. Do not expose
  raw service-account sessions through broad app-facing APIs; package exports
  should block direct app imports of service-account internals.
- Password-change flows need fresh user credentials and should not be folded
  into generic service-account execution.
- Local development without FreeIPA must keep working; service-account lookup
  failures must stay scoped to IPA-backed mutations.
- Do not run destructive FreeIPA smoke tests against production-linked local
  environments. Verify manually in a safe target realm.
