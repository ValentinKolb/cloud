---
id: grids-permissions
title: Permissions
icon: ti ti-lock
description: Share bases and resources without exposing unrelated data or actions.
order: 145
---
Grids checks access at the resource a person is using. This makes it possible to share a view, form, dashboard, Custom App, document template, or workflow without opening the entire base.

Cloud administrators are not automatic Grids superusers. They can manage access from the Grids administration area, but ordinary Grids pages still follow the same grants as every other user.

## Understand the access levels {icon="shield-lock"}

Not every resource supports every level:

| Resource | Available levels |
| --- | --- |
| Base | Read, Write, Admin, None |
| Stored table | Read, Write, None |
| Combined table | Read, None |
| View | Read, Admin, None |
| Form | Write/Use, None |
| Dashboard | Read, None |
| Custom App | Read, None |
| Document template | Read, Write, Admin, None |
| Workflow | Read, Write, Admin, None |

**Read** allows someone to see that resource and the data included in it. **Write** allows the resource's user action, such as changing records, generating documents, or running a workflow. **Admin** allows its configuration and access to be managed where supported. **None** is an explicit denial.

Structural tasks such as creating tables, forms, dashboards, document templates, and workflows require base administration even when the resulting resource can later be shared more narrowly.

## Inheritance and specific grants {icon="point"}

A table normally inherits access from its base. A child resource normally inherits through its table or base. When a more specific resource has matching access entries, that resource decides instead of the broader parent.

Within one resource, the most specific matching subject decides: a service account or user grant is considered before groups, then all authenticated users, then public access. An explicit `None` at the winning level prevents a broader allow from leaking through.

In practice:

- a user-specific table denial can override access inherited from a group;
- a readable view can expose its saved result without exposing the source table;
- a form can accept a submission from a user who cannot browse the table;
- a dashboard can include data while links from it still check their own targets.
- a Custom App requires its own explicit grant and separately checks every saved view it displays.

## Included data and linked targets {icon="point"}

**Included data** is rendered as part of the resource already opened, such as records in a view or numbers on a dashboard. It follows that resource's access.

Saved views and document templates are deliberate included-data boundaries. Their administrator chooses the stored GQL, including joins. Granting access exposes that saved result or generated document without granting access to browse the source tables or replace the stored query.

A Custom App adds another explicit boundary around its published page. App access alone never grants view access. A reader must be signed in, have a direct matching **Read** grant on the app, and be allowed to read every saved view whose records the app displays. Public Custom App grants are not available.

A **linked target** is a different resource opened separately. A dashboard link, a related record, or the original table checks its own access when opened. Do not assume that seeing a label grants navigation to its source.

## Documents and workflows {icon="route"}

Document template access has distinct purposes:

- **Read** lists generated runs and allows redownload from their stored snapshots.
- **Write** selects records, previews enabled templates, generates PDFs, and updates generated filenames or tags.
- **Admin** edits, enables, disables, shares, reorders, or deletes the template.

Workflow **Read** exposes the workflow and its permitted observability. **Write** starts direct or saved-launcher runs. **Admin** changes source, launchers, permissions, and configuration. A dashboard reader may run only the exact enabled launcher saved in a readable dashboard widget; this does not grant general workflow access. Every run rechecks access to the records, templates, and other targets its steps use.

## Share safely {icon="shield-lock"}

:::steps
1. Start with the narrowest useful resource.
2. Grant a group rather than many individuals when their role is stable.
3. Use a resource-specific grant when users should not browse its parent.
4. Test with a non-admin account.
5. Review links and actions, not only what is visible on the first screen.
:::

Public forms and expiring public document links are deliberate exceptions. Anyone holding the token can use that public surface until it is disabled, revoked, or expires.

:::note Permissions do not filter rows
A table grant applies to the table, not selected records. Use a view or dashboard as a controlled included-data surface when different readers should see a defined result.
:::
