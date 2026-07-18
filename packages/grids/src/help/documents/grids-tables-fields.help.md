---
id: grids-tables-fields
title: Tables & fields
icon: ti ti-table
description: Records, field types, relations, selects, Markdown, and formulas.
order: 110
---
Field type is a product decision. It controls validation, search, filtering, display, forms, relations, formulas, dashboards, document output, and exports.

### Choosing field types

- **Text and long text:** Use text for short labels and identifiers. Use long text for notes. Turn on Markdown when users need headings, links, or lists.
- **Number, decimal, percent:** Use decimal for money and exact arithmetic. Percent values are stored as ratios, so 0.75 displays as 75%.
- **Date and date-time:** Use date for days. Use date-time for exact moments. Current-time defaults are evaluated on the server when a record is created.
- **Select:** Use select when values must come from a known list. Colors help scanning; descriptions explain options in forms.
- **Relation and lookup:** Relations link records. Lookups display values through a relation without copying the source value.
- **Formula:** Formulas recalculate when records are read. Reference fields by name; quote names with spaces.

### Formula examples

**Total**

```text
price * quantity
```

**Fallback text**

```text
IFEMPTY(notes, 'No notes')
```

**Conditional**

```text
IF(inStock, 'Available', 'Out of stock')
```

**Date age**

```text
DATEDIFF(dueDate, TODAY(), 'days')
```

**Quoted name**

```text
"Unit price" * quantity
```

**Error fallback**

```text
IFERROR(total / quantity, 0)
```

### Rules that matter

- **Record label:** Pick a short readable field. Do not use long Markdown text as the title shown in relations and detail panels.
- **Required and default:** Required means a value must exist. Default only fills new create requests that omit the field.
- **Unique:** Use unique for identifiers such as invoice number, SKU, asset ID, or email. Avoid it for names that can repeat.
- **Index:** Index fields users filter, sort, search, or join often. Every index adds write cost, so do not index everything.

### Accountability and record lifecycle

- **Audit requirements:** In Table settings, open Data integrity to require structured answers before selected field changes, moving records to trash, or restoring them.
- **Focused change reasons:** Apply update questions to every edit or only to sensitive fields. The backend rejects protected changes when required answers are missing.
- **Permanent history:** Each accepted answer is stored with the operation in record history. Question and option labels are copied into the event, so older entries remain understandable after settings change.
- **Trash and restore:** Deleted records remain in trash and can be restored. Restore questions create a new history event and never overwrite the original deletion reason.
