---
id: oauth-start
title: Start
icon: ti ti-key
description: OAuth clients, redirect URLs, access rules, scopes, secrets, and OIDC endpoints.
order: 100
---

OAuth lets admins register external applications that use the Cloud login as an OAuth 2.0 and OpenID Connect provider.

## Overview {icon="layout-grid"}

:::reference
- **Client:** One external application. Each client has a client id, redirect URLs, allowed scopes, and access rules.
- **Public client:** A client without a secret. Use it for browser or native clients that cannot keep a secret.
- **Confidential client:** A server-side client with a secret. New and regenerated secrets are shown once.
- **Access rules:** Limit a client to full users, all profiles, or selected users and recursive group members.
:::

## Admin workflow {icon="route"}

:::reference
- **Create a client:** Set a name, redirect URI, optional logout URI, scopes, access rules, and whether the client is public.
- **Copy integration values:** Use the client id, optional secret, discovery URL, authorization URL, token URL, UserInfo URL, and JWKS URL in the external app.
- **Adjust access:** Edit the client to change scopes or switch between profile-based access and selected users or groups.
- **Rotate or remove:** Regenerate a confidential client secret when it is exposed. Delete a client to stop new OAuth flows for that app.
:::

## Scopes and claims {icon="shield-lock"}

:::reference
- **openid:** Required for OIDC. Returns the subject identifier.
- **profile:** Returns name and display-name claims.
- **email:** Returns the user's email claim.
- **groups:** Returns all group names, including inherited group membership.
:::

:::info CLI and API
The `oauth` CLI can list, inspect, create, update, delete, and regenerate secrets for clients through the same admin API used by this page.
:::
