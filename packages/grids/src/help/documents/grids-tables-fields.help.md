---
id: grids-tables-fields
title: Tables & fields
icon: ti ti-table
description: Choose field types and manage the lifecycle of saved records.
order: 110
---
A table stores one kind of record. Its fields define which facts every record can hold and how Grids treats those values in tables, forms, filters, formulas, documents, workflows, and exports.

Choose a field type for the meaning of the value, not merely for how it should look.

### Fields for entered values

| Field type | Use it for | Important behavior |
| --- | --- | --- |
| Text | Names, codes, email addresses, and short labels | Single-line text; a good default record label |
| Long text | Notes and descriptions | Can display Markdown when configured |
| Number | Quantities, prices, measurements, and exact decimal arithmetic | May show a unit and decimal precision |
| Percent | Percentages | Uses 0–100 by default; a field can instead use a 0–1 fraction scale |
| Boolean | Yes/no facts | Stores true, false, or empty when optional |
| Date | A day or an exact date-time | Date-time values represent a moment; current-time defaults are evaluated on the server |
| Duration | Elapsed time | Stored as seconds; accepts seconds, `MM:SS`, or `HH:MM:SS` |
| Select | A value from a controlled list | Options can have labels, colors, and descriptions; a select may allow several values |
| JSON | Structured data that does not need its own Grids fields | Use sparingly; individual properties are less convenient to filter and explain |
| File | Attachments and images | Files are stored with the record and use the configured file-size limit |

Use **Required** when an empty value would make a record invalid. A **Default** fills a value only when a new record omits that field. Use **Unique** for identifiers that must not repeat, such as an asset code or invoice number.

### Fields that connect or calculate

- **Relation** links one record to one or several records in another table. The target table's record label is shown in pickers and cells.
- **Lookup** displays one field from a related record without copying it.
- **Rollup** summarizes values reached through a relation.
- **Formula** calculates a value from fields in the current record whenever the record is read.
- **ID** creates a stable generated identifier. Configure it for the identifier style the process needs instead of maintaining counters by hand.
- **Created at, Created by, Updated at, and Updated by** are system-managed fields. They describe record activity and cannot be entered as ordinary business values.

Choose a relation when the target has its own details or lifecycle. A customer name typed into every invoice is only text; a Customer relation keeps the invoice connected when the customer's details change.

### Formulas in a table

Formula fields use the same expression language as computed query columns. Reference fields by name, quote names containing spaces with double quotes, and keep text literals in single quotes.

**Line total**

```text
"Unit price" * Quantity
```

**Readable fallback**

```text
IFEMPTY(Notes, 'No notes')
```

**Days until due**

```text
DATEDIFF(TODAY(), "Due date", 'days')
```

Open **Formulas** for the full function reference. Use `IFERROR` only when an error is an expected case, such as division by zero; otherwise let the error reveal a broken formula.

### Search, filters, and indexes

Text, long text, ids, numbers, percentages, durations, dates, booleans, select labels, and readable relation labels participate in broad search. Use filters for exact conditions and for calculated, lookup, rollup, file, or empty-value rules.

An index helps fields used often for filtering, sorting, search, joins, or unique checks. Every index also adds write work, so add one for an observed access pattern rather than every field.

### Record identity and history

Choose one short, readable **record label** for every table. It is the title shown in relation pickers and detail panels. A long description is usually a poor label even when it is unique.

Records use optimistic version checks. If another user or tab changes a record before your edit is saved, Grids rejects the stale write instead of silently overwriting newer data. Reload the record, review the newer values, and apply the change again.

Moving a record to trash is reversible. Restoring it creates a new history event; it does not erase the deletion event.

### Require change context

In **Table settings → Data integrity**, an admin can require answers before sensitive field updates, moving records to trash, or restoring them. Questions can apply to every update or only when selected fields change.

The submitted answers are stored with the record history. Grids copies the question and option labels into the event, so old history remains understandable after the policy changes.

:::note Model before display
Field type controls stored meaning. Views and column settings control how that value is presented in a particular context.
:::
