---
id: grids-core-model
title: Core model
icon: ti ti-stack-2
description: Learn how bases, tables, records, fields, and resources fit together.
order: 105
---
The Grids model separates saved facts from the ways people enter, inspect, present, and act on them. Understanding that separation prevents duplicate data and makes access easier to reason about.

### From a base to a value

A **base** is the boundary around one area of work. It contains tables and the resources built around them. Separate bases are useful when subjects have different owners, permissions, or operating rules.

A **table** stores one kind of thing. Customers and invoices belong in different tables because they have different fields and lifecycles. A table is not a page layout; the same table can be shown by several views and dashboards.

A **record** is one saved thing in a table. In a Customers table, each customer is a record. Records can be changed, moved to trash, restored, and inspected through their history.

A **field** stores one fact on every record in that table. Name, status, amount, due date, attachment, and owner are fields. The field type controls how a value is entered, validated, searched, filtered, displayed, and exported.

### Connect records instead of copying text

A **relation** links a record to records in another table. An invoice can link to one customer; a loan can link to several items. The linked table chooses a short **record label** so people see “Studio camera” instead of an internal id.

Use a relation when the linked thing has its own details or lifecycle. Use a normal field when the value belongs only to the current record. A lookup can display a value from a related record without copying it, and a rollup can summarize related values.

### Resources serve different jobs

The navigation around tables contains resources that use the saved data:

- A **view** keeps a query and a display mode for repeated work.
- A **form** creates records through a guided set of inputs.
- A **dashboard** arranges data and actions for a role or process.
- A **document template** defines a family of generated PDFs for records in one table.
- A **workflow** defines repeatable actions and how inputs move through them.

Each resource can have its own access rules. Seeing data included inside a readable view or dashboard does not automatically grant access to the original table or to a linked target opened separately.

### A useful mental check

When deciding where something belongs, ask:

- Is this a fact about one record? Add a field.
- Is this another thing with its own fields? Add a table and relation.
- Is this the same records shown for a particular task? Add a view.
- Is this a focused way to create records? Add a form.
- Is this a working page for a role? Add a dashboard.
- Is this printed output? Add a document template.
- Is this a repeatable operation? Add a workflow.

:::note One source of truth
Store business facts in tables. Views, forms, dashboards, documents, and workflows should use those facts rather than maintain competing copies.
:::
