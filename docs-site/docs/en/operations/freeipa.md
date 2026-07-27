---
title: FreeIPA setup
navTitle: FreeIPA setup
section: Operations
order: 1170
description: Connect a Cloud deployment to FreeIPA identity infrastructure.
tags: [freeipa, identity, directory]
updated: 2026-07-27
---

# FreeIPA setup

FreeIPA is optional.

Enable it when Cloud should authenticate and synchronize users from an existing
FreeIPA directory. Local accounts and magic-link login work without it.

## Configure the connection

Set the `freeipa.*` settings in Cloud administration.

The connection needs:

- the FreeIPA host name without `https://`;
- a service account user;
- the service account password;
- directory group rules.

`FREEIPA_URL`, `FREEIPA_SVC_USER`, and `FREEIPA_SVC_PASSWORD` can bootstrap the
first configuration.

Cloud enables the bootstrap automatically only when all three values exist.

## Configure TLS

Use `freeipa.ca_cert` for a private certificate authority.

`freeipa.allow_insecure` disables TLS verification. Use it only for local
development. A configured CA certificate takes precedence.

## Grant service-account permissions

Cloud uses JSON-RPC for:

| Area | Required operations |
| --- | --- |
| Users | add, modify, delete, find, show |
| Groups | add, modify, delete, find |
| Membership | add and remove members |
| Member managers | add and remove member managers |
| Hosts | modify, delete, find |
| Host groups | add, modify, delete, find, add members, remove members |
| Connectivity | ping |

Cloud does not create hosts.

Grant only these operations. FreeIPA privilege and role names depend on the
directory configuration, so verify them in the target instance.

Cloud authorization still runs before a directory mutation. The FreeIPA
service account is the downstream technical identity.

## Define group scope

| Setting | Meaning |
| --- | --- |
| `freeipa.groups.base_sync` | Groups whose members receive Cloud accounts |
| `freeipa.groups.base_ipa_realm` | Groups whose members become full users |
| `freeipa.groups.admin` | Groups that grant the Cloud administrator role |
| `freeipa.groups.excluded` | Groups omitted from mirrored memberships and hierarchy |

`base_sync` and `base_ipa_realm` are required. Cloud does not guess them.

Excluded groups remain available while Cloud evaluates sync scope. Cloud does
not mirror those groups or their membership and hierarchy edges.

## Verify the integration

Before enabling user traffic:

1. verify TLS and `ping`;
2. run a read-only user and group lookup;
3. confirm `base_sync` includes the intended population;
4. confirm full-user and guest classification;
5. confirm administrator group resolution;
6. test one allowed and one denied directory mutation;
7. inspect audit events;
8. test behavior while FreeIPA is unavailable.

See [Authentication](/docs/en/identity/authentication) and
[Actors and access](/docs/en/identity) for the resulting request identity.
