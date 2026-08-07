---
title: Grids
navTitle: Grids
section: Work
order: 140
description: Flexible application data with tables, views, forms, dashboards, documents, and workflows.
tags: [grids, tables, workflows]
updated: 2026-08-02
---

# Grids

Grids builds structured applications from tables and records. A base can grow
from a simple shared dataset into forms, saved views, dashboards, generated
documents, and workflows without splitting the domain across unrelated tools.

## Use Grids

- Create a base for one operational domain, then define tables, fields, and
  relationships around its records.
- Save filtered or grouped views for recurring work and reporting.
- Publish forms for guided record creation and dashboards for focused metrics,
  lists, instructions, and actions.
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
| Dashboard | Bounded operating surface composed from data and actions |
| Document and workflow | Generated output and a versioned sequence of checked effects |

Access starts at the base, while selected views, forms, dashboards, documents,
and workflow launchers can add narrower public or shared surfaces. Opening a
linked resource checks that target's access separately.

## How Grids fits Cloud

Grids owns its bases, schema, records, queries, views, forms, dashboards,
documents, and workflows. Cloud supplies identity, resource access,
notifications, background execution, audit and observability primitives, PDF
rendering, application discovery, and shared Help and administration surfaces.

## Find detailed product help

Open **Help** inside Grids for the core model, schema, formulas, views, forms,
dashboards, documents, permissions, GQL, workflows, and troubleshooting.
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
