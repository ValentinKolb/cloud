---
title: Identity and access
navTitle: Overview
section: Identity and access
order: 300
description: Identify callers and protect application resources.
tags: [identity, authentication, authorization]
updated: 2026-07-27
---

# Identity and access

Cloud owns accounts, sessions, credentials, roles, groups, and permission
primitives. Applications use that shared identity model.

Each request answers three separate questions:

| Question | Owner |
| --- | --- |
| Is the credential valid? | Cloud authentication |
| May this caller enter the route? | Route middleware |
| May this caller act on this resource? | The application service |

A valid login does not grant access to every resource. A route role does not
replace a resource permission check.

## Identity checks in one request

Authentication resolves two values:

```ts
const actor = c.get("actor");
const accessSubject = c.get("accessSubject");
```

`actor` identifies the credential that made the request. Use it for audit
context, credential scopes, and resource binding.

`accessSubject` identifies the principal whose grants apply. Pass it to the
shared access helpers.

The distinction matters for API keys:

| Caller | Actor | Access subject |
| --- | --- | --- |
| Browser session | User | Same user |
| Personal API key | Service account with delegated user | Delegated user |
| Resource API key | Resource-bound service account | Service account |
| OAuth authorization code | User | Same user |
| OAuth client credentials | Resource-bound service account | Service account |

Personal API keys use the user's live grants. Resource credentials use only
their own grants.

## Choose the right page

- [Request identity](/docs/en/identity/authentication) explains credential
  resolution, actors, and access subjects.
- [Route policies](/docs/en/identity/route-policies) selects who may enter a
  route and explains coarse platform roles.
- [Resource authorization](/docs/en/identity/authorization) checks one domain
  resource, adapter, and list query.
- [Machine credentials and OAuth](/docs/en/identity/service-accounts-and-oauth)
  covers API keys, service accounts, and OAuth flows.
- [Public access](/docs/en/identity/public-and-anonymous-access) handles routes
  that work without a session.

## Keep identity in Cloud

An application does not create another user table, session format, role
system, or credential store.

It owns:

- domain resources;
- resource-to-access junction tables;
- the permission required for each operation;
- resource binding and scope enforcement for machine credentials.

It does not own:

- accounts and groups;
- browser sessions;
- service-account identity;
- API-key hashing;
- OAuth token issuance.

Start with [Route policies](/docs/en/identity/route-policies) for route access.
Use [Resource authorization](/docs/en/identity/authorization) whenever a
request reads or changes a domain resource.
