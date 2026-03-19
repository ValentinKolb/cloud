# FreeIPA User Data Split

## Summary

Planned future refactor:

- move FreeIPA-specific user projection fields out of `auth.users`
- introduce a dedicated IPA-only table, tentatively `auth.ipa_user_data`
- expose the IPA-only data in the runtime/API model as:
  - `freeipaData: { ... } | null`

This is **not implemented yet**.
It is a recorded design decision for a later cleanup step.

## Goal

The canonical user model should stay lean:

- `id`
- `uid`
- `provider`
- `profile`
- `given_name`
- `sn`
- `display_name`
- `mail`
- `account_expires`
- `last_login_local`
- other truly shared/core user fields

Everything that exists only because the account is IPA-backed should move into a separate table and a separate runtime object.

This keeps the canonical account model simpler and makes it clearer that:

- `local` accounts are app-managed and intentionally lean
- `ipa` accounts carry extra directory-backed state
- FreeIPA remains the source of truth for IPA-specific fields

## Product Decision

### Local accounts should stay lean

Chosen direction:

- `phone` becomes IPA-only
- address fields become IPA-only
- local accounts should **not** own phone/address/profile-directory details

This is intentional.
The goal is not symmetry between `local` and `ipa`, but a clearer model:

- local account = lightweight app account
- IPA account = directory-backed account with richer metadata

### FreeIPA remains source of truth

No special migration effort is required for the IPA-only fields themselves.

Reason:

- FreeIPA is the single source of truth
- if IPA-specific projection data is dropped locally, the next IPA sync can restore it

This makes the split substantially easier than other schema migrations.

## Proposed Table Shape

Tentative future table:

- `auth.ipa_user_data`

Suggested columns:

- `user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`
- `uid_number INTEGER`
- `ipa_password_expires TIMESTAMPTZ`
- `last_login_ipa TIMESTAMPTZ`
- `synced_at TIMESTAMPTZ`
- `employee_type TEXT`
- `mobile TEXT`
- `addr_street TEXT`
- `addr_postal_code TEXT`
- `addr_city TEXT`
- `addr_state TEXT`
- `ssh_public_keys TEXT[]`
- `ssh_fingerprints TEXT[]`

Possible later additions:

- Kerberos-specific projected fields if they are reintroduced or needed explicitly

## Proposed Runtime/API Shape

Future `FullUser` shape for IPA-backed accounts:

- top-level canonical user data remains on the main user object
- IPA-specific fields move under:
  - `freeipaData`

Example:

```ts
type FullUser = {
  id: string;
  uid: string;
  provider: "local" | "ipa";
  profile: "user" | "guest";
  mail: string | null;
  accountExpires: string | null;
  lastLoginLocal: string | null;
  freeipaData: {
    uidNumber: number | null;
    passwordExpires: string | null;
    lastLoginIpa: string | null;
    employeeType: string | null;
    mobile: string | null;
    address: {
      street: string | null;
      postalCode: string | null;
      city: string | null;
      state: string | null;
    };
    sshPublicKeys: string[];
    sshFingerprints: string[];
    syncedAt: string | null;
  } | null;
};
```

Expected behavior:

- `provider="ipa"` -> `freeipaData` populated
- `provider="local"` -> `freeipaData = null`

## Fields Intended To Stay On `auth.users`

These should remain canonical/top-level:

- `id`
- `uid`
- `provider`
- `profile`
- `given_name`
- `sn`
- `display_name`
- `mail`
- `account_expires`
- `last_login_local`

Legacy compatibility fields may still exist for a while during the transition, but they are not part of the target model.

## Fields Intended To Leave `auth.users`

These are considered IPA-only projection data:

- `uid_number`
- `ipa_password_expires`
- `last_login_ipa`
- `synced_at`
- `employee_type`
- `mobile`
- `addr_street`
- `addr_postal_code`
- `addr_city`
- `addr_state`
- `ssh_public_keys`
- `ssh_fingerprints`

Important:

- `phone` is also intended to become IPA-only by product decision
- local accounts should no longer own phone/address style profile data

## Legacy / Transition Notes

### `ipa_account_expires`

`ipa_account_expires` is not part of the intended long-term runtime model.

The canonical runtime field remains:

- `account_expires`

`ipa_account_expires` should be treated as legacy/mirror compatibility and not elevated into the future `freeipaData` API shape.

### Contacts / Files / Other consumers

Several runtime paths currently still read IPA-specific fields directly from `auth.users`, for example:

- accounts user detail / session user builders
- IPA sync and IPA user mutation services
- system contacts projection
- files app `uid_number` usage

These will need to be updated together when the split is implemented.

## Implementation Direction For Later

When this is implemented later, the preferred order is:

1. create `auth.ipa_user_data`
2. dual-write IPA sync and IPA mutations into the new table
3. update canonical read builders to populate `freeipaData`
4. update downstream consumers like contacts/files/accounts UI
5. stop reading IPA-specific fields from `auth.users`
6. drop the old columns from `auth.users` only after all readers are migrated

Because FreeIPA is the source of truth, the data migration itself is less risky than normal schema reshaping.

## Status

Current status:

- decision recorded
- not yet implemented

This document exists so the later implementation can follow a clear product and schema direction without reopening the data-model question.
