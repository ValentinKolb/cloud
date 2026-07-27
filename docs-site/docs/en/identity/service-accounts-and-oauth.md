---
title: Machine credentials and OAuth
navTitle: Machine credentials
section: Identity and access
order: 350
description: Create API keys or OAuth clients without bypassing resource authorization.
tags: [identity, service-accounts, oauth, oidc]
updated: 2026-07-27
---

# Machine credentials and OAuth

Cloud uses service accounts for credentials that are not browser sessions.

Your application receives the resulting actor. Cloud stores the service
account and issues OAuth tokens.

## Choose the identity

Cloud has two service-account kinds:

| Kind | Identity | Grants |
| --- | --- | --- |
| `user_delegated` | A credential acting for one user | The delegated user's live grants |
| `resource_bound` | A machine identity bound to one app resource | Explicit service-account grants |

Personal API keys use a user-delegated service account.

Resource API keys and OAuth client credentials use a resource-bound service
account.

Do not combine the delegated user's grants with the service account's grants.

## Choose the credential

| Credential | Lifetime | Issuer | Use |
| --- | --- | --- | --- |
| Cloud API key | Long-lived until expiry or revocation | Credential service | Scripts and integrations |
| OAuth authorization code | Short-lived access token for a user | OAuth app | Third-party application acting for a user |
| OAuth client credentials | One-hour access token for a resource service account | OAuth app | Service-to-service integration |

All successful credentials are accepted by the same
[request identity middleware](/docs/en/identity/authentication).

## Create a resource API key

A resource API key gives an integration access to one application resource.

Each create, list, and revoke route requires a user-backed actor with `admin`
permission on that resource.

Provision one resource-bound service account in the application's serialized
resource lifecycle:

```ts
const existing = await serviceAccounts.getByResource({
  appId: "inventory",
  resourceType: "item",
  resourceId: item.id,
});

const serviceAccount = existing
  ? ok(existing)
  : await serviceAccounts.createResourceBound({
      name: `${item.name} API access`,
      appId: "inventory",
      resourceType: "item",
      resourceId: item.id,
      createdBy: user.id,
    });

if (!serviceAccount.ok) return serviceAccount;
```

Retain the selected service-account ID with the application resource.
`getOrCreateResourceBound()` is a convenience lookup. It is not a database
uniqueness boundary. Serialize provisioning when duplicates would be
incorrect.

Grant the service-account principal a stable maximum permission through the
application's resource adapter. For example, grant `admin` when this
integration family may create read, write, or admin keys.

Several keys can share the account. Each key scope can only lower the stable
grant. Creating or revoking a key does not reconcile the grant.

Before creating a key, load the selected account and verify its exact binding:

```ts
const account = await serviceAccounts.get({ id: serviceAccountId });

if (
  !account ||
  account.status !== "active" ||
  account.kind !== "resource_bound" ||
  account.appId !== "inventory" ||
  account.resourceType !== "item" ||
  account.resourceId !== item.id
) {
  return fail(err.notFound("Resource service account"));
}
```

Then create the credential:

```ts
const created =
  await serviceAccountCredentials.createResourceApiToken({
    serviceAccountId: account.id,
    actor: user,
    name: "Warehouse sync",
    expiresAt: "2027-01-01T00:00:00.000Z",
    scopes: ["write"],
  });

if (!created.ok) return created;
```

| Input | Required | Meaning |
| --- | --- | --- |
| `serviceAccountId` | Yes | Active resource-bound account |
| `actor` | Yes | User creating the key |
| `name` | Yes | Integration name |
| `expiresAt` | No | ISO timestamp or `null` |
| `scopes` | No | Permission caps such as `read`, `write`, or `admin` |

The raw token is returned once. Later list operations return metadata and the
token prefix.

List keys with resource filters:

```ts
const page = await serviceAccountCredentials.listOverview({
  pagination: { page: 1, perPage: 100 },
  filter: {
    serviceAccountKind: "resource_bound",
    credentialStatus: "active",
    appId: "inventory",
    resourceType: "item",
    resourceId: item.id,
  },
});
```

Map each credential's scopes to one `PermissionLevel` before returning it to
`ResourceApiKeys`. Use the highest recognized value: `admin`, then `write`,
then `read`, otherwise `none`.

Before revoking a credential, load its overview and verify that it belongs to
the requested resource. `revoke()` only checks the credential ID and current
status.

```ts
const credential = await serviceAccountCredentials.getOverview({
  id: credentialId,
});

if (
  !credential ||
  credential.serviceAccount.kind !== "resource_bound" ||
  credential.serviceAccount.appId !== "inventory" ||
  credential.serviceAccount.resourceType !== "item" ||
  credential.serviceAccount.resourceId !== item.id
) {
  return fail(err.notFound("API key"));
}

const revoked = await serviceAccountCredentials.revoke({
  credentialId,
  actor: user,
});

if (!revoked.ok) return revoked;
```

Revocation disables the secret. It does not remove the service account or its
resource grant.

Every request made with the key must match its exact `appId`, `resourceType`,
and `resourceId`. Resolve the service-account grant and cap it with the
credential scope. Scopes never create access.

## Add the API-key UI

Use `ResourceApiKeys` in the resource's admin-only settings surface:

```tsx
import {
  type ResourceApiKey,
  ResourceApiKeys,
} from "@valentinkolb/cloud/ui";

<ResourceApiKeys
  title="API keys"
  description="Keys for integrations that work with this item."
  initialKeys={apiKeys}
  createKey={async (input) => {
    const response = await apiClient[":id"]["api-keys"].$post({
      param: { id: item.id },
      json: input,
    });
    if (!response.ok) throw new Error("Failed to create API key.");
    return (await response.json()) as {
      credential: ResourceApiKey;
      token: string;
    };
  }}
  revokeKey={async (credentialId) => {
    const response = await apiClient[":id"]["api-keys"][":credentialId"].$delete({
      param: { id: item.id, credentialId },
    });
    if (!response.ok) throw new Error("Failed to revoke API key.");
  }}
/>
```

The component owns the create dialog, permission and expiry inputs, local list
updates, revoke confirmation, and one-time token display. The application owns
the API routes and their authorization.

Keep human and group grants in `PermissionEditor`. Hide service-account entries
from that editor unless administrators need to manage them directly.

`ResourceApiKeys` accepts:

| Prop | Use |
| --- | --- |
| `initialKeys` | Credential metadata with a derived `permission` |
| `permissionOptions` | Optional labels and allowed grantable levels |
| `createKey(input)` | Create a key and return its metadata plus the raw token |
| `revokeKey(id)` | Revoke one key |
| `title` / `description` | Optional resource-specific copy |

## Authorization-code flow

Use authorization code when an integration acts for a person.

The flow uses:

```text
GET  /oauth/authorize
POST /oauth/token
```

The authorization request accepts:

| Parameter | Required | Meaning |
| --- | --- | --- |
| `client_id` | Yes | OAuth client ID |
| `redirect_uri` | Yes | Exact registered redirect URI |
| `response_type` | Yes | Must be `code` |
| `scope` | No | Space-separated allowed scopes |
| `state` | No | Client state returned unchanged |
| `nonce` | No | Included in OpenID Connect processing |
| `code_challenge` | Public clients | PKCE challenge |
| `code_challenge_method` | With challenge | `S256` for public clients; `S256` or `plain` for confidential clients |

Public clients must use PKCE with `S256`.

Exchange the returned code:

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=<code>&
redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&
client_id=<client-id>&
code_verifier=<verifier>
```

Confidential clients can send credentials through HTTP Basic or the form.

The resulting access token resolves to a user actor. `offline_access` can
produce a refresh token.

## Client-credentials flow

Use client credentials for a service that acts on one application resource.

The OAuth client must:

- be confidential;
- reference an active resource-bound service account;
- allow every requested scope;
- allow the optional requested resource audience.

Request a token:

```http
POST /oauth/token
Authorization: Basic <base64(client_id:client_secret)>
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&
scope=read&
resource=inventory-api
```

The response contains:

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "id_token": null,
  "scope": "read"
}
```

The token resolves to a resource-bound service-account actor.

The application must still verify:

- `appId`;
- `resourceType`;
- `resourceId`;
- the service-account access grant;
- the credential scope cap.

OAuth scopes do not grant domain access.

## Configure an OAuth client

OAuth client creation supports:

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | Required | Display name, 1–120 characters |
| `description` | None | Description, up to 1,000 characters |
| `redirectUris` | `[]` | Allowed authorization-code callbacks |
| `logoutUri` | None | Optional post-logout URI |
| `scopes` | `openid profile email` | Allowed scopes |
| `audiences` | `cloud` | Allowed token audiences and resource values |
| `serviceAccountId` | `null` | Resource service account for client credentials |
| `allowedProfiles` | `user, guest` | User profiles allowed to authorize |
| `accessMode` | `profiles` | Profile-based or explicit user/group access |
| `allowedUserIds` | `[]` | Users allowed in `specific` mode |
| `allowedGroupIds` | `[]` | Direct or nested group members allowed in `specific` mode |
| `isPublic` | `false` | Public client without a secret |

Supported scopes:

```text
openid profile email groups offline_access read write admin
```

Scope, audience, redirect, user, and group lists accept at most 50 entries.

`serviceAccountId` is valid only for an active resource-bound service account.
Clients with a service-account binding must be confidential.

## Restrict who may authorize a client

`allowedProfiles` rejects account profiles outside the configured list.

With `accessMode: "profiles"`, every allowed profile may authorize.

With `accessMode: "specific"`, the user must also be listed directly or belong
to an allowed group. Select at least one user or group. Nested group membership
is included.

These client restrictions decide who may authorize the OAuth client. They do
not replace application resource permissions.

## Validate access tokens in applications

Applications do not import `oauthTokens` or verify JWTs.

Use:

```ts
auth.requireRole("authenticated");
```

Then read `actor` and `accessSubject` from the request context.

Continue with [Request identity](/docs/en/identity/authentication) and
[Resource authorization](/docs/en/identity/authorization).
