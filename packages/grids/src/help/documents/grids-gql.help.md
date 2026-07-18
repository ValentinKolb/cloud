---
id: grids-gql
title: GQL
icon: ti ti-code
description: Query syntax, examples, resolution, permissions, limits, and performance rules.
order: 125
---
GQL, the Grids Query Language, describes records and summaries in text. Use it for filters, selected fields, sorting, grouping, aggregations, joins, document template sources, and reports that are clearer as code than as many dropdown settings.

### Minimal query

- **Source:** Start with `from table Books` or `from view "Open loans"`. On a table/view page the source can be implied, but saved queries are easier to review when the source is written down.
- **All fields by default:** Omit `select` to return all source fields. Add `select` when the output should be stable, narrow, or renamed.
- **Names and values:** Use double quotes for field names with spaces. Use single quotes for text values. `status = 'Open'` compares a field to text.

**Minimal filtered query**

```gql
from table Books
select Title, Author, Published
where Status = 'Available'
sort Published desc
limit 25
```

### Defaults

- **No select:** All source fields are returned. This is useful while exploring; saved views are clearer when important fields are listed.
- **No alias:** A selected field keeps its field name. Formulas and aggregates need aliases because they do not have a stable field name.
- **No direction:** Sort defaults to ascending with nulls last. Write desc when newest, largest, or latest values should come first.
- **No where:** No rows are filtered out. You see every record the source query allows.
- **No sort:** The source decides the order. Add sort when order matters, especially before offset.
- **No from on a table page:** The current table or view can be used as the source. Write from explicitly when the query should be portable.

### Clause order

GQL reads like a checklist. You do not need every line, but when several lines are present this order is easiest to understand:

```gql
from table ...
join ...
select ...
where ...
search ...
group by ...
aggregate ...
having ...
sort ...
limit ...
offset ...
include deleted | deleted only
```

### Clause reference

- **from:** Choose the source table or view. Add as alias when the same source is joined again or scoped refs should be shorter.
- **join:** Load related records through relation fields. Use left join for optional relations.
- **select:** Choose output columns. Use commas for several fields and aliases for readable computed or joined values.
- **where:** Filter records before grouping. Supports field comparisons, membership, null checks, date helpers, and formulas.
- **search:** Search all searchable source fields, or scope search to specific fields when the query should be narrow.
- **group by:** Turn records into summary rows. Date groups can use buckets such as month when supported by the field.
- **aggregate:** Calculate count, countEmpty, countUnique, sum, avg, min, max, median, earliest, latest.
- **having:** Filter grouped rows after aggregation.
- **sort:** Sort rows or summaries. Use nulls first/last when missing values need a defined position.
- **limit and offset:** limit accepts 1..10000 and caps the complete result across cursor pages. offset accepts 0..10000 and skips an initial result window.
- **include deleted / deleted only:** Opt into deleted records. The two clauses are mutually exclusive.

:::note Result pages
The query explorer, saved result views, dashboards, and the CLI execute the same GQL. Page cursors are opaque, signed, and tied to the exact query and source. Changing the query starts again at the first page. In the CLI, use `--page-size` for one page or `--all --max-rows N` for a bounded multi-page read. Pages are live reads, not a database snapshot; concurrent record changes can move rows between page requests.
:::

### Names and values

- **Readable names:** Use table and field names directly when they are unambiguous.
- **Quoted names:** Use `"Birth year"` when a name contains spaces or punctuation.
- **Literal text:** Use single quotes: `Status = 'Open'`.
- **IDs:** Use brace-wrapped UUIDs only when a generated template or migration needs an immutable reference.
- **Scoped refs:** Use source or join aliases for clarity after joins, for example customer.Name or o.Total.

### Filter patterns

Most filters are field comparisons. Use formulas when the condition itself is calculated. Keep literal text in single quotes so GQL does not treat it as another field name.

**Multiple conditions**

```gql
from table Inventory
where Status = 'Available' and Quantity > 0
sort Name asc
```

**Formula predicate**

```gql
from table Products
where Price <= "Purchase price" * 1.10
select Name, Price, "Purchase price"
```

**Computed result column**

```gql
from table Products
select Name, Price, formula(Price * 1.19) as gross
where Price > 0
sort gross desc
```

### Search

Search is a broad text lookup across searchable fields. Use `where` for exact values, numeric/date comparisons, and rules that must not depend on display text.

**Search all searchable fields**

```gql
from table Books
search 'tolkien'
limit 20
```

**Search selected fields**

```gql
from table Books
join table Authors as author on Author = author.id
search 'kingdom' in Title, author.Country
limit 20
```

### Operators and helpers

- **Comparisons:** Use `=`, `!=`, `>`, `>=`, `<`, and `<=`.
- **Boolean logic:** Use `and`, `or`, `not`, and parentheses. Do not use `AND(...)`, `OR(...)`, or `NOT(...)`.
- **Text helpers:** Use `contains`, `startswith`, `endswith`, and their case-insensitive forms `icontains`, `istartswith`, and `iendswith`.
- **Membership:** Use `oneof(Field, 'a', 'b')`, `noneof(Field, 'a', 'b')`, or `containsall(Field, 'a', 'b')` for select, multi-value, and relation-style membership checks.
- **Nulls and empty values:** Use `null` in expressions. Add `nulls first` or `nulls last` to a sort when missing values need a defined position.

### Joins in plain language

A join follows a relation from the source record to another table. The join condition must target the joined record id. For example, if Orders has a Customer relation, join Customers through that relation and compare it to `customer.id`.

**Join through a relation**

```gql
from table Orders
left join table Customers as customer on Customer = customer.id
select "Order number", customer.Name as customer_name, Total
limit 50
```

### Paging and one-line queries

Line breaks are optional; they make longer queries easier to scan. Use semicolons when several clauses share one physical line. Use `-- comment` for comments. Always sort before using offset.

**Same query on one line**

```gql
from table Orders; select "Order no", "Line total"; where Status = 'Paid'; sort "Ordered at" desc; limit 10
```

**Second page of newest orders**

```gql
from table Orders
sort "Ordered at" desc
limit 25
offset 25
```

### Grouping and summaries

Grouped queries return summary rows, not editable records. They are useful for dashboards, charts, reports, exports, and document templates.

**Chart-ready grouped query**

```gql
from table Orders
group by "Ordered at" by month
aggregate sum(Total) as revenue, count(*) as orders
having revenue > 0
sort "Ordered at" asc
```

### Deleted records

Normal queries read live records. Add one deleted-record clause only when the result explicitly needs records from the trash.

**Live and deleted rows**

```gql
from table Assets
include deleted
sort Name asc
limit 100
```

**Deleted rows only**

```gql
from table Assets
deleted only
sort Name asc
limit 100
```

### Interactions and edge cases

- **Permissions:** A source only runs if the user can read it. Joins and relation targets are checked instead of exposing hidden tables.
- **View sources:** Row-shaped saved views can be queried as record sources. Summary views are summary tables, not editable record sources.
- **No browser-side work:** Filtering, sorting, joins, grouping, and aggregations must be expressed in GQL so execution stays server-side.
- **Ambiguity:** When a source, field, or alias is ambiguous, GQL should fail instead of guessing.
- **Not SQL:** GQL does not support SQL-style select-from order, arbitrary join predicates, subqueries, CTEs, window functions, or raw SQL expressions.
- **Removed aliases:** Use offset instead of skip. Use readable field names, quoted names, scoped refs, or stable ids instead of #field refs.

These examples show common GQL shapes. Copy one, replace source and field names with the names from your base, then preview before saving.

### GQL patterns

Open work

A normal filtered table view.

```gql
from table Tasks
select Name, Status, Due
where Status = 'Open'
sort Due asc
limit 50
```

Monthly chart source

A grouped view that can feed a chart.

```gql
from table Orders
group by "Ordered at" by month
aggregate sum("Line total") as revenue
sort "Ordered at" asc
```

Computed output

A temporary computed column in a query result.

```gql
from table Products
select Name, Price, formula(Price * 1.19) as gross
where Price > 0
limit 20
```

Readable names

Quote labels with spaces. Keep text values in single quotes.

```gql
from table "Line Items"
select "Item name", "Net amount"
where "Approval status" = 'Approved'
sort "Net amount" desc
```

### Formula patterns

**Formula-only output**

```gql
from table Products
select Name, formula(Price - Cost) as margin
sort margin desc
```

**Formula predicate**

```gql
from table Products
where Price - Cost > 0
select Name, Price, Cost
```

GQL is compiled, permission-checked, and executed on the server. This page explains the mechanics for people who need to reason about correctness, access, and performance.

### Execution model

- **Parse:** GQL text is parsed into a small known set of clauses. Unknown syntax fails before any data is read.
- **Resolve:** Names, ids, aliases, relations, formulas, groups, and aggregations resolve against the visible base schema.
- **Check permissions:** Sources, joins, relation targets, and view sources are checked before execution.
- **Compile to SQL:** Supported queries compile to SQL. Grids does not use browser-side aggregation to make a query work.
- **Preview or save:** The query workspace can preview advanced shapes. Compatible row and grouped queries can be saved as views.

### Limits and defaults

- **Omitted select:** Missing select means all source fields. Saved views are clearer when important fields are explicit.
- **Result bounds:** limit caps the complete logical result across every page. Without limit, result views continue through stable server cursors.
- **Meaningful order:** Add sort when order has business meaning. Grids adds a stable tie-breaker so cursor pages do not duplicate or omit equal values.
- **Errors:** Parser, resolver, and compiler errors should be shown instead of silently falling back to a different interpretation.

:::note One source of truth
The visual query controls and the GQL editor are different ways to describe server-side query behavior. The database remains the place where filtering, sorting, grouping, joins, and aggregations happen.
:::
