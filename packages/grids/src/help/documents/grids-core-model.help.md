---
id: grids-core-model
title: Core model
icon: ti ti-stack-2
description: Bases, tables, records, fields, relations, resources, and permission boundaries.
order: 105
---
A Grids base is a set of connected resources around saved table data. Keep the model simple first: tables store records, fields define record shape, and the other resources read from or write to those tables.

### Core objects

- **Base:** One workspace for one subject, such as finance, inventory, hiring, or a bookshop.
- **Table:** One kind of record. Customers, invoices, books, items, and loans usually belong in separate tables.
- **Record:** One saved item inside a table. Records are the rows that views, forms, dashboards, templates, and workflows use.
- **Field:** One fact about a record: status, amount, due date, owner, file, relation, formula, barcode, or ID.
- **Relation:** A field that links records across tables. Relation labels come from the target table's record label field.
- **Resource:** A shareable item such as a table, view, form, dashboard, document template, generated document, or workflow.

### How the pieces connect

- **Tables store data:** Use tables as the source of truth. Do not encode data only in dashboards, documents, or workflow payloads.
- **Views shape data:** Use views to filter, sort, group, aggregate, and choose a display mode without copying records.
- **Forms write records:** Use forms to create records with guided fields. Submission still checks the target table permission.
- **Dashboards include data:** Use dashboards to present included data, forms, links, Markdown, and workflow buttons in one operating page.
- **Templates render documents:** Use GQL sources and Liquid HTML to turn selected records into generated PDFs.
- **Workflows run actions:** Use workflow YAML for inputs, optional automatic triggers, and steps. Keep launchers, the workflow name, and its description outside YAML.

:::note Permission boundary
Permissions are resource-based. A dashboard, view, form, generated document, or workflow can have its own access without granting open access to every linked target.
:::
