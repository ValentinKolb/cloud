# Auth and FreeIPA

## Source of Truth

FreeIPA is the source of truth for managed identities and permissions.

The cloud keeps a local auth database for application queries and joins, but FreeIPA-driven changes are synced back into local tables.

## User Realm Types

User realms are defined as `ipa`, `ipa-limited`, `guest`.

- `guest`: local email-token account only.
- `ipa-limited`: IPA-backed account with limited role set.
- `ipa`: IPA-backed account with full IPA realm privileges.

Realm roles are mutually exclusive.

## Sync Behavior

Implemented in `cloud/packages/core/src/services/ipa/sync.ts`.

- periodic full sync runs every 5 minutes
- users are scoped by `GROUPS_BASE_SYNC`
- realm is derived from local group memberships using `GROUPS_BASE_IPA_REALM`
- sync upserts users/groups/hosts/hostgroups and rebuilds membership join tables
- IPA users no longer present in sync scope are demoted to `guest`

## Promotion and Demotion

- guest to IPA promotion is supported (mail-based matching to avoid duplicate identities)
- IPA users can be demoted to guest while preserving local account continuity
- session invalidation is used where required to force clean re-auth

## Login-Time Refresh

A lightweight user refresh runs on login (`syncUser`) to update user attributes.

Group topology is still synchronized by periodic full sync, not by login refresh.
