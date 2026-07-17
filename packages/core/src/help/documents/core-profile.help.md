---
id: core-profile
title: Profile
icon: ti ti-user-circle
description: Account self-service, FreeIPA requests, API keys, passkeys, groups, and activity history.
order: 110
---

The Profile page is the user's own account cockpit. It combines local Cloud data, optional FreeIPA data, and self-service account actions.

## Profile sections

- **Identity:** Shows display name, uid, avatar, provider, profile type, supplemental roles, email, phone, address, account expiry, and password expiry when available.
- **Groups:** Shows direct group membership by default. The page can switch to recursive group membership through the groups query parameter.
- **FreeIPA request:** Local users can request a FreeIPA account when FreeIPA is enabled. Pending requests can be withdrawn from the same page.
- **Activity:** Shows recent self-service audit activity for the selected time window.

## Security controls

- **API keys:** Delegated service-account credentials owned by the user. Active keys can be managed from Profile.
- **Passkeys:** WebAuthn passkeys attached to the signed-in user and used for passkey login.
