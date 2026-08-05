---
id: grids-custom-apps
title: Custom Apps
icon: ti ti-apps
description: Turn one Grids base into focused standalone applications.
order: 132
---
<!-- Unreleased contract: register this article only with the complete Custom Apps vertical slice. -->

Custom Apps turn the resources in one Grids base into a focused application. People open the app at its own Cloud URL instead of working in the full Grids workspace. The base remains the source of truth: the app arranges existing views, forms, workflows, templates, and records without copying their data or rules.

Use a Custom App for a guided process that needs several connected pages. Examples include a request portal, an internal review surface, a repeated-entry flow, or an inventory lending portal.

## Choose the smallest useful surface {icon="route"}

Start with the smallest Grids resource that solves the job:

| Need | Use |
| --- | --- |
| Collect one new record | A **Form** |
| Repeatedly inspect or edit a defined result | A **View** |
| Carry out a repeatable operation | A **Workflow** |
| Build and administer data and resources | The **Grids workspace** |
| Guide an audience across several resources and pages | A **Custom App** |

**Blank** and **Dashboard** are starting presets for a Custom App. They are not separate resource kinds. Blank starts with an empty page; Dashboard starts with a compact metrics-and-records layout.

There is also no separate admin-app kind. An administrative surface is an ordinary Custom App whose access is granted to the responsible Cloud group. Being a Cloud administrator does not implicitly grant access to its base, app, or records.

## Know the three roles {icon="users"}

- A **base administrator** creates resources, builds the app, configures access, previews the draft, and publishes it.
- An **app user** opens the published app and can use only the pages, resources, rows, and operations allowed for their Cloud account and groups.
- A **CLI or agent author** reads and writes the same typed app definition as the visual builder. It receives no broader permission than the Cloud account running the command.

All Cloud accounts use the same permission model. Grids introduces no separate identity model or anonymous Custom App access.

## Understand the app model {icon="layout-grid"}

Every Custom App belongs to exactly one base. A base can have several apps for different audiences without duplicating records.

```text
App
└─ Page
   └─ Row
      └─ Column
         └─ Block
```

Rows and columns provide a responsive 12-column layout. Blocks connect the page to existing Grids resources:

| Block | Purpose |
| --- | --- |
| Markdown | Explain a task or add safe images and links |
| Records | Show a bounded saved view or GQL result |
| Metrics | Highlight values from a bounded result |
| Chart | Visualize a bounded grouped result |
| Form | Create a record through an existing form |
| Record | Show or edit explicitly allowed fields on one record |
| Comments | Discuss the page's current record |
| Actions | Navigate or run an enabled workflow launcher |

The layout and block settings are app configuration. They do not add a scripting runtime, unrestricted HTML or CSS, another form system, or another record store.

Read [Pages & blocks](/app/grids/help/grids-custom-app-pages-blocks) for the complete composition model.

## Keep every operation with its owner {icon="shield-check"}

Custom Apps compose existing Grids behavior:

- **Views and GQL** own record selection, filtering, sorting, grouping, and summaries.
- **Forms** own validation, record creation, and configured fixed values.
- A **Record** block owns only the explicitly enabled direct field edits.
- **Workflows** own business transitions, multi-record changes, and effects such as notifications.
- **Comments** belong to one record and load only when that record page is opened.
- **Document runs** own generated PDFs and their downloads.

The same operation therefore behaves consistently whether it starts in a Custom App, the Grids workspace, or automation.

## Pass only declared context {icon="arrow-right"}

Pages and blocks use four typed value sources:

- **`PARAMS`** contains only parameters declared by the current page.
- **`RECORD`** contains the optional authorized record loaded by that page.
- **`ROW`** contains the current item while a Records block builds one row link or action.
- **`RESULT`** contains the documented synchronous result of the form or workflow action that just completed.

For example, a list can navigate to the page `request` with `request_id` from `ROW.id`. The detail page declares `request_id`, loads the authorized record, and makes it available as `RECORD`. A successful create form can navigate to the same page with `request_id` from `RESULT.recordId`.

Context improves composition; it never grants access. Values are type-checked and authorized on the server before a resource is read or an operation runs.

## Share without widening access {icon="lock"}

Opening an app is only the first permission check. Every read and operation must pass three independent boundaries:

1. the account may open the app;
2. the published app snapshot may use the referenced resource and operation;
3. the account's resource grant and row scope allow the requested data or action.

Row scope can allow all records, records created by the current account, or child records related through one declared parent relation created by the current account. A responsible group can receive an `all` scope while requesters receive `created_by` or `related_created_by` on the same resource.

Conditions may hide irrelevant blocks or actions, but they are presentation only. Permissions and row scope remain authoritative. Read [Publish & permissions](/app/grids/help/grids-publish-custom-app) for the full access and lifecycle contract.

## Draft, preview, and publish {icon="rocket"}

Editing changes one mutable draft; the latest saved edit wins. Publishing creates the snapshot served at `/apps/<shortId>`. Later draft changes do not affect visitors until the next publish.

The stable short URL points to the current published snapshot. Custom Apps do not add revision history, rollback, or deletion semantics in the first release.

The visual builder, YAML, CLI, and agents all use the same typed definition. YAML is a lossless serialization of that definition, not a second product model.

Before publishing, preview valid, empty, missing, and inaccessible states at desktop and narrow widths. Publishing is refused when a resource is missing, a value reference is invalid, a query exceeds its bounds, an operation lacks a declared capability, or the app could disclose data outside its access contract.

Follow [Build your first Custom App](/app/grids/help/grids-build-custom-app) for a complete request-and-certificate example. Use [YAML & CLI](/app/grids/help/grids-custom-app-yaml-cli) when the same app should be built or reviewed by an agent.
