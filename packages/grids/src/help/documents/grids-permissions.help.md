---
id: grids-permissions
title: Permissions
icon: ti ti-lock
description: Read, write, admin, included data, linked items, and documents.
order: 145
---
Grids permissions are resource-based. A user can have access to a dashboard, view, or generated document without automatically receiving open access to every linked table, form, or original source.

### Access levels

- **Read:** Lets a user see the item and included data for that item.
- **Write:** Lets a user add or change records where the resource supports writing.
- **Admin:** Lets a user change structure, sharing, views, forms, dashboards, workflows, and document templates.
- **Linked resources:** A dashboard link does not grant access to its target. The target checks permissions when opened.

### Documents

- **Template setup:** Creating a template starts from base/table admin access. Existing templates can also be managed by users with admin access on that document template.
- **Generate and redownload:** Generating from a saved template and redownloading its runs require read access to that template or inherited table/base access.

:::note Included vs linked
Data shown inside a dashboard or saved view follows that resource's access. Opening the original table, opening a linked target, or submitting a form checks the original resource.
:::
