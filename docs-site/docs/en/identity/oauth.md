---
title: OAuth clients and flows
navTitle: OAuth
section: Identity and access
order: 355
description: Configure OAuth clients and choose authorization code or client credentials.
tags: [identity, oauth, oidc]
updated: 2026-08-04
---

# OAuth clients and flows

Use authorization code when an integration acts for a person. Use client
credentials when a service acts on one application resource.

Both flows use the platform identity model. Applications receive `actor` and
`accessSubject`; they do not verify OAuth tokens themselves.

## Authorization-code flow

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
| `resource` | No | Exact allowed RFC 8707 resource audience |
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

When the authorization request used `resource`, the token request must repeat
the exact same value. Cloud binds the authorization code and any resulting
refresh-token family to it. This is required by the
[Cloud MCP server](/en/docs/platform/mcp).

Confidential clients can send credentials through HTTP Basic or the form.

The resulting access token resolves to a user actor. `offline_access` can
produce a refresh token.

## Client-credentials flow

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
resource=https%3A%2F%2Fcloud.example%2Fapi%2Finventory
```

Every `resource` value is an absolute URI without a fragment. When supplied,
the resulting access token is valid only for that exact audience.

The token resolves to a resource-bound service-account actor.

The application must still verify:

- `appId`;
- `resourceType`;
- `resourceId`;
- the service-account access grant;
- the credential scope cap.

OAuth scopes do not grant domain access. See
[Resource authorization](/en/docs/identity/authorization#limit-resource-bound-credentials).

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

## Restrict authorization

`allowedProfiles` rejects account profiles outside the configured list.

With `accessMode: "profiles"`, every allowed profile may authorize. With
`accessMode: "specific"`, the user must also be listed directly or belong to an
allowed group. Nested group membership is included.

These client restrictions decide who may authorize the OAuth client. They do
not replace application resource permissions.

## Validate access tokens

Applications do not import `oauthTokens` or verify JWTs. Apply
`auth.requireRole("authenticated")`, then read `actor` and `accessSubject` from
the request context.

Continue with [Request identity](/en/docs/identity/authentication) and
[Resource authorization](/en/docs/identity/authorization).
