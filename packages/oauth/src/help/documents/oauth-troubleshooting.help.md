---
id: oauth-troubleshooting
title: Troubleshooting
icon: ti ti-lifebuoy
description: Fix redirect mismatches, denied users, missing claims, invalid secrets, and failed authorization flows.
order: 120
---

## Common failures {icon="lifebuoy"}

:::reference
- **Redirect URI mismatch:** Compare the complete URL sent by the application with the registered redirect URI, including scheme, port, path, and trailing slash.
- **The user is denied:** Review whether the client allows full users, all profiles, or only selected users and recursive group members.
- **A claim is missing:** Confirm that the corresponding scope is allowed on the client and requested by the application.
- **The client secret fails:** Confirm the application uses the latest secret and the confidential-client flow expected by its library. Regenerating a secret invalidates the old one.
- **A public client asks for a secret:** Configure the external library as a public client and use its supported PKCE flow.
- **Logout does not return correctly:** Register the exact logout callback expected by the application.
:::

## Debug safely {icon="point"}

Use the visible authorization error, client id, redirect URI, requested scopes, and time of the attempt. Never include authorization codes, tokens, client secrets, or session cookies in support messages.
