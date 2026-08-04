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

Keep three decisions separate:

| Question | Owner |
| --- | --- |
| Is the credential valid? | Cloud authentication |
| May this caller enter the route? | Route middleware |
| May this caller act on this resource? | The application service |

A valid login does not grant access to every resource. A route role does not
replace a resource permission check.

## Continue by task

| Task | Page |
| --- | --- |
| Understand the actor and access subject | [Request identity](/en/docs/identity/authentication) |
| Decide who may enter a route | [Route policies](/en/docs/identity/route-policies) |
| Check access to one domain resource | [Resource authorization](/en/docs/identity/authorization) |
| Create a credential for one resource | [Resource API keys](/en/docs/identity/resource-api-keys) |
| Integrate an OAuth client | [OAuth](/en/docs/identity/oauth) |
| Allow a route without a session | [Public access](/en/docs/identity/public-and-anonymous-access) |

Cloud owns identity and credentials. The application owns its domain resources
and decides which permission each operation requires.
