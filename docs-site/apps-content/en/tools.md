---
title: Tools
navTitle: Tools
section: Everyday
order: 230
description: Small generators, converters, security helpers, media utilities, and network tests.
tags: [tools, utilities, generators, network, cli]
updated: 2026-08-02
---

# Tools

Tools collects small utilities for day-to-day work so they are discoverable in
one place. Use the workspace for quick generation, conversion, inspection, and
testing tasks that do not need their own application.

## Use Tools

- Generate mailto links, QR codes, UUIDs, placeholder text, and passwords.
- Encode or decode Base64, Hex, or Base32 and convert color formats.
- Calculate hashes or encrypt and decrypt text for controlled workflows.
- Crop, adjust, annotate, redact, and export an image in the browser.
- Measure a connection or create a temporary endpoint to inspect webhooks.

Check where each task runs before entering sensitive data. Most generators,
converters, security helpers, and image operations are interactive page tools.
Speed tests call the Cloud server, and webhook endpoints and request history
are stored server-side.

## Understand the Tools model

| Resource or surface | Responsibility |
| --- | --- |
| Tool definition | A named utility grouped by task and category for browsing and search |
| Browser utility | Processes its interactive input in the page and offers copy or download output |
| Speed test | Measures ping, download, upload, and jitter against the Cloud server |
| Webhook endpoint | A user-owned receiving URL with server-side request history |

Webhook logs redact common sensitive headers such as `Authorization` and
`Cookie`, but paths and bodies can still contain private data. Use synthetic
payloads when possible.

## How Tools fits Cloud

Tools owns the utility catalog, browser interactions, speed-test endpoints, and
user-owned webhook records. Cloud supplies the shared application shell,
identity for stored network tools, settings, lifecycle, and the in-product Help
surface.

## Find detailed product help

Open **Help** inside Tools to choose the right utility and review data-handling
guidance. Developers can read
[Application shells](/en/docs/frontend/application-shells),
[Authentication](/en/docs/identity/authentication), and
[Build typed HTTP APIs](/en/docs/server/http) for the shared contracts used by
the workspace and its server-backed tools.

## Run Tools from the terminal

Tools provides a native CLI module. Most commands run locally and do not need
a Cloud profile:

```bash
cld tools uuid --count 3 --json
cld tools color "#2563eb" --json
```

Run `cld tools help` to see the available generators, encoders, security
helpers, and speed test. Run `cld tools <command> --help` for exact inputs and
output options.
