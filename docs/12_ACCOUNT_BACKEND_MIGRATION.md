# Unified Account Backend Migration

## Summary

The account backend now uses one canonical user model:

- `provider: "local" | "ipa"`
- `profile: "user" | "guest"`
- `accountExpires: string | null`

The public API is unified:

- `POST /users` creates local and IPA users via `provider` + `profile`
- `POST /users/:id/switch-provider` switches provider via a target `provider`
- `POST /users/:id/set-profile` is unified and rejects IPA users explicitly
- `POST /users/:id/set-expiry` is unified and always targets the canonical expiry
- `POST /users/:id/send-login-link` and `POST /users/:id/reset-password` stay on the same resource and validate by provider
- `/groups` is unified and dispatches internally by target group provider

The migration was implemented additive-first to preserve identity, capabilities, and relations.

## Implemented Migration Steps

### 1. Canonical contract and runtime model

The shared contracts now expose:

- canonical `provider`
- canonical `profile`
- canonical `accountExpires`
- flattened derived runtime `roles`

`roles` remain a runtime convenience view and are not persisted.

Relevant files:

- `packages/contracts/src/shared.ts`
- `packages/core/src/services/accounts/model.ts`
- `packages/core/src/services/accounts/authz.ts`

### 2. Add canonical database expiry

The user table now includes:

- `auth.users.account_expires TIMESTAMPTZ`

Migration behavior:

- existing IPA expiry is backfilled into `account_expires`
- existing local guest expiry is backfilled into `account_expires`
- legacy expiry columns remain present during transition

Relevant file:

- `packages/core/src/migrate/core/auth.ts`

### 3. Unified account services

`packages/core/src/services/accounts/users.ts` is now the central user service and owns:

- canonical reads
- provider-aware create/update/remove
- provider-aware `set-profile`
- provider-aware `set-expiry`
- provider-aware `switch-provider`
- unified `send-login-link`
- unified `reset-password`
- provider-safe group and manager reads

`packages/core/src/services/accounts/groups.ts` is now the central groups service and owns:

- unified `get/list/search`
- provider-aware create/update/remove
- provider-aware member/manager dispatch

### 4. Real local provider implementation

`packages/core/src/services/providers/local/users.ts` is now a real implementation instead of a legacy re-export.

It owns:

- local user creation
- local guest creation
- local updates
- local profile switching
- local expiry updates
- local deletion

### 5. IPA provider remains remote-first

IPA-backed mutations remain FreeIPA-first:

1. mutate FreeIPA
2. only mirror locally on success

This remains true for:

- IPA user create/update/delete
- IPA expiry mutation
- IPA provider switch flows
- IPA sync refresh

Relevant files:

- `packages/core/src/services/ipa/users.ts`
- `packages/core/src/services/ipa/sync.ts`

### 6. Unified lifecycle around one expiry field

Lifecycle now uses canonical `account_expires` as the runtime expiry source.

Automatic policy remains provider/profile-specific:

- `user.account.ipa_expires_days`
- `user.account.local_user_expires_days`
- `user.account.local_guest_expires_days`

Implemented lifecycle paths:

- IPA expiry backfill
- local user expiry backfill
- local guest expiry backfill
- reminder generation from one canonical expiry field
- guest cleanup still deletes expired local guests
- expired IPA accounts still demote to local guests

Relevant files:

- `packages/core/src/services/account-lifecycle/index.ts`
- `packages/core/src/services/account-lifecycle/scheduler.ts`
- `packages/core/src/services/settings/defaults.ts`

### 7. Unified API routing and frontend-only Accounts app

The account management API now lives under:

- `/api/accounts/*`
- `/api/accounts/me`

`/api/auth` stays limited to authentication and session flows.

The Accounts app is now a frontend-only shell:

- pages
- page-local API route wiring
- frontend components

Business logic ownership lives in core:

- `packages/core/src/services/accounts/*`
- `packages/core/src/services/accounts/app.ts`

Relevant files:

- `packages/apps/src/accounts/index.ts`
- `packages/apps/src/accounts/api.ts`
- `packages/apps/src/accounts/api/me.ts`
- `packages/apps/src/accounts/api/users.ts`
- `packages/apps/src/accounts/api/groups.ts`
- `packages/core/src/api/index.ts`

## Data Preservation Rules Implemented

The migration was implemented to preserve data and relations:

- existing `auth.users.id` is preserved during provider switches
- `local -> ipa` updates the same row instead of recreating it
- `ipa -> local` updates the same row instead of recreating it
- local group memberships are preserved across provider switches
- local manager-user relations are preserved across provider switches
- IPA-only memberships and manager relations are removed only when the account stops being IPA-backed
- canonical reads fall back to legacy expiry columns during transition, so older rows are still interpreted correctly

## API Shape After Migration

### Users

Canonical endpoints:

- `GET /users`
- `POST /users`
- `GET /users/:id`
- `PATCH /users/:id`
- `DELETE /users/:id`
- `POST /users/:id/switch-provider`
- `POST /users/:id/set-profile`
- `POST /users/:id/set-expiry`
- `POST /users/:id/send-login-link`
- `POST /users/:id/reset-password`

Provider behavior is validated on the unified resource:

- IPA profile mutation is rejected explicitly
- local password reset is rejected explicitly
- IPA login-link sending is rejected explicitly

### Groups

Canonical endpoints:

- `GET /groups`
- `POST /groups`
- `GET /groups/:id`
- `PATCH /groups/:id`
- `DELETE /groups/:id`
- `POST /groups/:id/members`
- `DELETE /groups/:id/members`
- `POST /groups/:id/managers`
- `DELETE /groups/:id/managers`

Dispatch behavior:

- local target group -> local implementation
- IPA target group -> IPA implementation

## Remaining Legacy / Compatibility Residue

Backend/core runtime and all non-Accounts apps are now on canonical account semantics.

The remaining legacy residue is intentionally narrowed to the final Accounts-app phase and to schema/history compatibility.

### 1. Route-prefix legacy is gone

Current status:

- `/api/ipa/*` is removed for account management
- `/api/me` is removed
- canonical account management now lives under `/api/accounts/*`
- self-service account actions now live under `/api/accounts/me`

Remaining residue is now schema/history compatibility, not API topology.

### 2. `realm` still exists as schema/history residue

Current status:

- backend runtime outside the Accounts app no longer reads `realm` to decide behavior
- `realm` still exists on `auth.users`
- deleted-account history still stores `previous_realm`

Still deferred:

- dropping `auth.users.realm`
- dropping deleted-account `previous_realm` after the Accounts-app readers are migrated

### 3. Legacy account helpers still exist as compatibility utilities

Still present in the shared model layer:

- `LegacyRealm`
- `providerProfileFromRealm(...)`
- `realmFromProviderProfile(...)`

Current status:

- they are no longer the source of truth for backend/non-Accounts runtime behavior
- they remain only for compatibility/history cleanup that belongs to the final migration phase

### 4. Legacy expiry columns are still mirrored

Still present in the schema:

- `ipa_account_expires`
- `guest_expires_at`

Current status:

- canonical runtime behavior reads `account_expires`
- legacy columns are still dual-written for transition safety

### 5. Compatibility endpoints still exist

Still present as wrappers:

- `POST /users/:id/create-ipa`
- `POST /users/:id/make-local`

Current status:

- canonical behavior should use `POST /users/:id/switch-provider`

## Current `auth` Schema Overview

The current `auth` schema contains a mix of:

- canonical runtime tables
- transition compatibility tables
- pure migration/audit tables
- old host-related tables that no longer belong to the account domain

### Canonical runtime tables that are still actively needed

- `auth.users`
  - canonical account rows
  - runtime source for `provider`, `profile`, `account_expires`, mail, login metadata, and mirrored IPA attributes
- `auth.groups`
  - canonical group rows
  - runtime source for `id`, `provider`, `name`, description, and POSIX metadata
- `auth.user_groups_v2`
  - canonical user-to-group memberships by group `id`
- `auth.group_groups_v2`
  - canonical nested group relations by group `id`
- `auth.group_manager_users_v2`
  - canonical direct manager-user relations by group `id`
- `auth.group_manager_groups_v2`
  - canonical manager-group relations by group `id`
- `auth.account_requests`
  - request records for the current `local -> FreeIPA` self-service flow
- `auth.access`
  - generic app-wide access-control principal table
- `auth.deleted_accounts`
  - lifecycle deletion audit/history
- `auth.account_lifecycle_reminders`
  - reminder history / lifecycle audit

### Compatibility / migration-source tables that still exist

- `auth.user_groups`
- `auth.group_groups`
- `auth.group_manager_users`
- `auth.group_manager_groups`

These are the old `cn`-based junction tables. The current runtime uses the `_v2` tables, but these old tables still matter for upgrades from older production releases because the migration backfills `_v2` from them.

### Migration artifact tables

- `auth.account_requests_backup`

This is not a runtime table. It exists only because the account-request table can be rebuilt during migration, with a backup kept for safety.

### Host tables that no longer belong to the account domain

- `auth.hosts`
- `auth.hostgroups`
- `auth.host_hostgroups`
- `auth.hostgroup_hostgroups`

These are now effectively foreign to the account backend and are the clearest candidates for later removal. They should be treated separately from the account cleanup because older instances may still carry them.

### Important legacy columns still embedded in active tables

- `auth.users.realm`
- `auth.users.ipa_account_expires`
- `auth.users.guest_expires_at`
- `auth.groups.cn`
- `auth.access.group_cn`
- `auth.deleted_accounts.previous_realm`

These are no longer the canonical model, but some of them are still required for migration compatibility or legacy reader/writer residue.

## Important Transition Constraint: `auth.groups.cn`

`auth.groups.cn` is still structurally important today even though the runtime model is `id + provider + name`.

Why:

- the old schema used `cn` as the primary identity column for groups
- the old junction tables still reference `groups.cn`
- upgrades from older production instances still depend on this compatibility layer

Practical consequence:

- new local groups must still receive a deterministic compatibility `cn`
- otherwise the insert fails on existing instances where `groups.cn` is still `NOT NULL`

Current compatibility strategy:

- IPA groups keep their directory `cn`
- local groups get a synthetic compatibility key prefixed with `local:`

Example:

- local group name `test-group` -> compatibility `cn = 'local:test-group'`

This keeps the current instance working while preserving upgrade safety from older releases.

### 6. Remaining low-priority Accounts UX residue

The final Accounts-app migration is complete, but a few low-priority cleanup items remain intentionally deferred because they are not correctness or security issues:

- shared user/group presentational components still live under `packages/lib/src/ui/ipa/*` even though they now render canonical local and IPA entities
- the admin user detail page still uses large `perPage` values when loading full group collections for one user; this is acceptable at current scale but is a good future optimization target if group cardinality grows substantially
- wrappers remain until all callers are migrated

### 6. Legacy runtime settings fallbacks are removed, but stale data/keys may still exist

Removed from runtime logic:

- `user.account.expires_days`
- `user.account.guest_expires_days`

Current status:

- canonical runtime settings are:
  - `user.account.ipa_expires_days`
  - `user.account.local_user_expires_days`
  - `user.account.local_guest_expires_days`
- older databases or docs may still mention the old keys, but backend runtime no longer reads them

### 7. Legacy roles are removed from backend/non-Accounts runtime

Current status:

- runtime generation and runtime consumption outside the Accounts app no longer use `ipa-limited`
- non-Accounts apps now gate on canonical `user` / `guest` / provider-specific checks
- the Accounts app still needs its final cleanup pass

### 8. Legacy IPA service modules still exist

`packages/core/src/services/ipa/*` still contains mature remote mutation and sync logic.

Current status:

- ownership is reduced, but not fully deleted yet
- the final structural cleanup can move more of this into `providers/ipa/*` once the Accounts app is fully migrated

## Current TODOs

### Accounts-app phase

1. Replace remaining Accounts-app `requireRole("ipa")` guards with canonical semantics.
2. Migrate deleted-account UI away from `previousRealm`.
3. Update Accounts-app account-request wording and any remaining guest-only assumptions.
4. Remove final Accounts-app references to old role or realm wording.

### Final schema/history cleanup

1. Drop `auth.users.realm`.
2. Drop deleted-account `previous_realm` once no reader depends on it.
3. Remove dual-write to `ipa_account_expires` and `guest_expires_at` once no reader depends on them.
4. Remove compatibility endpoint aliases once all callers use `switch-provider`.
5. Remove shared compatibility helpers that only exist for the last cleanup step.
6. Continue collapsing `services/ipa/*` into the provider-owned modules where it meaningfully reduces duplication.

## Review Follow-up Status

The first external senior review produced several implementation findings. The meaningful ones have been addressed:

- fixed: app session invalidation after `ipa -> local` provider switch
- fixed: admin demotion now uses one atomic backend demotion path instead of two sequential mutations
- fixed: `/me` profile updates now route through the unified `accounts.users.update` path
- fixed: IPA sync stale-user demotion now prefers the canonical `user.account.local_guest_expires_days` setting
- fixed: users who only manage local groups now derive `group-manager` correctly in the session model
- fixed: local group member/manager reads now honor `recursive` instead of silently ignoring it
- reduced legacy duplication: the old `ipa.users.addGuest` path is no longer exposed through the `ipa` facade

Still intentionally unresolved:

- `show_all=true` group visibility remains a policy choice and was not tightened in this migration
- compatibility endpoint aliases remain active
- `realm`, deleted-account `previous_realm`, and legacy expiry mirror columns remain as transition residue

## Verification

Verified during implementation with:

- `bun run scripts/run-package-typechecks.ts`
- `bun run check:biome`

Note:

- the repo-global `bun run typecheck` currently fails before package typechecks because the repository `check:skills` gate reports missing `skills/*/agents/openai.yaml` files unrelated to the account migration itself.
