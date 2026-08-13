---
title: Grids
navTitle: Grids
section: Work
order: 140
description: Structured data with Bases, Views, Forms, Custom Apps, documents, and workflows.
tags: [grids, tables, workflows]
updated: 2026-08-10
---

# Grids

Grids builds structured applications from tables and records. A base can grow
from a simple shared dataset into forms, saved views, dashboards, generated
documents, and workflows without splitting the domain across unrelated tools.

## Use Grids

- Create a base for one operational domain, then define tables, fields, and
  relationships around its records.
- Save filtered or grouped views for recurring work and reporting.
- Publish Forms for guided record creation and Custom Apps for focused metrics,
  lists, instructions, and actions.
- Reuse a saved View's Cards layout and image cover in a Custom App, or expose
  bounded Bulk workflow actions on a table Records block. Published Apps pin
  the View contract and recheck selected records server-side.
- Keep relationships between compatible Form inputs, such as a start date that
  must not follow its due date, in server-enforced cross-field validation.
- Generate documents or PDFs from reviewed templates and record data.
- Run typed, versioned workflows for repeatable record changes, document
  generation, email delivery, and bounded HTTP calls.

Use formulas for derived values and workflows for multi-step effects that need
inputs, permissions, revisions, and observable runs.

## Understand the Grids model

| Resource | Responsibility |
| --- | --- |
| Base | Permission boundary and catalog for one structured application |
| Table, field, and record | Schema, typed columns, and stored domain rows |
| View and form | Reusable read perspective and guided record submission |
| Custom App | Immutable published capability surface for a focused audience |
| Document and workflow | Generated output and a versioned sequence of checked effects |

Base access opens the complete raw workspace and every record in that Base.
Tables, Views, Forms, document templates, and Workflows do not have separate
Cloud grants. Use a published Custom App when an authenticated or public
audience needs only selected data, Forms, documents, and actions. App readers
do not need Base access, and an app grant never opens raw Grids APIs or GQL.
Base grants support service accounts. Custom App grants support users, groups,
all authenticated accounts, or the public, but not service accounts. Delegated
credentials access a Custom App through their user identity.

Custom App pages, blocks, Forms, and actions can use server-enforced GQL
availability rules with request context such as `@auth.id`, `@params.*`, and
`@time.now`. Public apps receive `@auth.id = null`; Workflow actions still
require an authenticated account.

## How Grids fits Cloud

Grids owns its bases, schema, records, queries, views, forms, dashboards,
documents, and workflows. Cloud supplies identity, resource access,
notifications, background execution, audit and observability primitives, PDF
rendering, application discovery, and shared Help and administration surfaces.

## Find detailed product help

Open **Help** inside Grids for the core model, schema, formulas, Views, Forms,
Custom Apps, public publishing, documents, permissions, GQL, workflows, and troubleshooting.
Developers can read [Resource authorization](/en/docs/identity/authorization),
[Workflow overview](/en/docs/automation/workflow-overview), and
[PDF and templates](/en/docs/platform/pdf-and-templates) for shared contracts
Grids adopts.

## Automate Grids from the terminal

Grids provides a native CLI module for every major resource area. These
read-oriented commands list bases and records from a chosen table:

```bash
cld grids list --json
cld grids records list --base "Operations" --table "Requests" --limit 20 --json
```

Run `cld grids help` for bases, schema, records, views, forms, Custom Apps,
documents, templates, and workflows. Run `cld grids <area> <command> --help`
before changing schema, data, access, or automation.
