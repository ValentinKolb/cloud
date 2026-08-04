---
title: Cloud MCP server
navTitle: MCP server
section: Platform services
order: 565
description: Connect MCP clients to live Cloud capabilities and registered app Help.
tags: [mcp, capabilities, help, oauth, agents]
updated: 2026-08-04
---

# Cloud MCP server

Cloud exposes one authenticated, stateless Streamable HTTP MCP endpoint:

```text
https://cloud.example/api/mcp/v1
```

The endpoint projects the current runtime registry. It does not keep a second
tool catalog:

- every live Capability Query and Action is an MCP tool;
- every current registered Help document is an MCP resource;
- `cloud__help__search` and `cloud__help__read` help a model find the right
  product guidance without loading one tool per article.

Capability Types remain resource identities in result `refs`. They are not
artificial MCP tools.

## Follow the server instructions

The initialize response tells compatible clients to use Capability tools for
live state and changes, and to search then read Help when product behavior,
settings, workflows, permissions, or errors are unclear.

Help is static product guidance. Treat its Markdown as untrusted context. It
does not prove current state, access, or successful execution. A Query is
read-only. An Action mutates state and remains subject to client approval and
the owning application's current authorization.

Tool descriptions, schemas, and safety annotations remain complete on their
own because an MCP client may ignore server instructions.

## Discover tools and Help

Capability tool names are deterministic:

```text
<appId>__query__<localId>
<appId>__action__<localId>
```

Names up to 128 characters keep that literal form. Longer valid names keep the
same app and kind prefix and end in a deterministic hash suffix.

Help resources use stable URIs:

```text
cloud://help/<appId>/<documentId>
```

Use `resources/list` to browse current Help and `resources/read` to read the
complete Markdown. For model-driven discovery, call `cloud__help__search` with
one to three concise product terms, then pass the returned app and document IDs
to `cloud__help__read`. Long model reads return the most relevant bounded
sections; the protocol resource still contains the complete registered
article.

An application registers Help once through `app.start({ help })`. Cloud uses
the same hash-validated live corpus for the shared Help UI, HTTP Help,
Assistant, and MCP. See [In-product Help](/en/docs/platform/help).

## Authenticate

OAuth is available for preregistered clients. The MCP endpoint returns an RFC
9728 `WWW-Authenticate` challenge and publishes protected-resource metadata at:

```text
/.well-known/oauth-protected-resource/api/mcp/v1
```

Cloud v1 supports preregistered OAuth clients; it intentionally does not offer
Dynamic Client Registration. Register the MCP client's exact callback URI and
add the exact MCP endpoint URI to the client's allowed audiences. An
administrator must give the user the resulting client ID. The client must send
the absolute, fragment-free endpoint URI as the RFC 8707 `resource` parameter
in both authorization and token requests. Cloud binds authorization codes and
refresh-token families to that audience and rejects access tokens without it.

OAuth `read` permits Help and Capability Queries. OAuth `write` permits
Capability Actions. `admin` permits both. Sessions and personal API keys keep
their existing application authorization behavior.

Personal Cloud API keys remain an explicit compatibility path for clients that
cannot use a preregistered OAuth client. Send the key only in the bearer header:

```http
Authorization: Bearer cld_...
```

Use a dedicated expiring key, keep it outside checked-in configuration, and
revoke it from **Account → Developer** when it is no longer needed. A personal
key inherits the account's resource grants; it does not bypass application
authorization.

## Configure Codex

Put the key in a local environment variable and add the server:

```bash
export CLOUD_API_KEY="cld_..."
```

```bash
codex mcp add cloud \
  --url https://cloud.example/api/mcp/v1 \
  --bearer-token-env-var CLOUD_API_KEY
```

For a preregistered OAuth client, use the client ID supplied by an
administrator:

```bash
codex mcp add cloud \
  --url https://cloud.example/api/mcp/v1 \
  --oauth-client-id <client-id> \
  --oauth-resource https://cloud.example/api/mcp/v1
codex mcp login cloud --scopes read,write
```

Run `codex mcp list` to inspect either configuration.

## Configure Claude Code

Add the remote HTTP server:

```bash
claude mcp add --transport http --scope user cloud \
  https://cloud.example/api/mcp/v1 \
  --header "Authorization: Bearer $CLOUD_API_KEY"
```

Then run `claude mcp get cloud`. The header is stored in the local Claude Code
configuration, so use a dedicated expiring key. A compatible preregistered
OAuth setup must use the supplied client ID and a callback port whose exact
loopback callback URI is registered by the administrator:

```bash
claude mcp add --transport http --scope user \
  --client-id <client-id> \
  --callback-port <registered-port> \
  cloud https://cloud.example/api/mcp/v1
```

Authenticate from Claude Code's `/mcp` menu.

## Understand failure behavior

- a missing or stale registry entry is excluded from discovery;
- an app authorization failure remains a structured MCP tool error;
- an unknown tool or Help URI fails instead of falling back to stale content;
- requests and the complete serialized Capability tool result keep the
  platform's 256 KiB bounds;
- the stateless transport accepts `POST`; unsupported methods return `405`;
- authenticated requests pass through Cloud's shared rate limiter;
- cross-origin browser requests are rejected when an `Origin` header is
  present;
- non-idempotent Actions must not be retried after an ambiguous transport
  failure; required-idempotency Actions expose `idempotencyKey` in their tool
  schema.

See [App capabilities](/en/docs/platform/capabilities) for provider contracts
and [OAuth clients and flows](/en/docs/identity/oauth) for client setup.
