---
id: grids-gql
title: GQL
icon: ti ti-code
description: Find, combine, and summarize Grids data with the Grids Query Language.
order: 125
---
GQL is the Grids Query Language. It describes which saved data you want and how Grids should shape the result. The query explorer, saved views, dashboard widgets, document sources, exports, and CLI use the same language.

You do not need GQL for ordinary table work. Start with Search, Filter, Sort, and Computed controls. Use GQL when text makes a precise query easier to understand, reuse, or review.

### Read a first query

This query reads the Books table, keeps available books, chooses three fields, orders the newest first, and returns at most 25 rows:

```gql
from table Books
where Status = 'Available'
select Title, Author, Published
sort Published desc
limit 25
```

Each line is one clause:

- `from` chooses a table or saved view.
- `where` removes records that do not match an exact rule.
- `select` chooses the output columns.
- `sort` defines the order.
- `limit` deliberately caps the complete result.

Write field and table names as shown in Grids. Put names containing spaces in double quotes, such as `"Birth year"`. Put text values in single quotes, such as `'Available'`.

### Build a query safely

Start with only the source and preview it:

```gql
from table Books
```

Then add one concern at a time: a filter, selected fields, and finally a meaningful sort. The editor resolves accessible tables, views, fields, relations, and aliases as you type. Diagnostics identify syntax, unknown names, ambiguity, incompatible operations, and permission failures instead of guessing.

Omitting `select` returns all source fields. This is convenient while exploring. List important fields explicitly when a saved result, document, or integration needs a stable output.

### Common query tasks

**Find exact records**

```gql
from table Tasks
where Status = 'Open' and Priority != 'Low'
sort Due asc
```

Use `where` for rules that must remain exact. Use `search` for broad discovery across searchable display values:

```gql
from table Books
search 'tolkien'
limit 20
```

Search can be restricted to named fields:

```gql
from table Books
search 'kingdom' in Title, Country
limit 20
```

**Add a calculated result**

```gql
from table Products
select Name, Price, formula(Price * 1.19) as gross
where Price > 0
sort gross desc
```

The calculation is part of this result and does not create a table field.

**Summarize records**

```gql
from table Orders
group by "Ordered at" by month
aggregate sum(Total) as revenue, count(*) as orders
having revenue > 0
sort "Ordered at" asc
```

Grouping returns summary rows rather than editable records. Use it for reports, charts, dashboards, documents, and exports. `where` filters source records before grouping; `having` filters the calculated groups.

**Follow a relation**

If Orders has a Customer relation, a join can expose fields from Customers:

```gql
from table Orders
left join table Customers as customer on Customer = customer.id
select "Order number", customer.Name as customer_name, Total
sort "Order number" asc
limit 50
```

The relation field on the left must target the joined alias's `id`. Use `left join` when records without a related target should remain in the result.

### Clause order

Not every query needs every clause. When clauses are combined, keep them in this order so the source remains easy to scan:

```text
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

Line breaks are optional. Use semicolons when several clauses share one line, and `-- comment` for a comment:

```gql
from table Orders; where Status = 'Paid'; sort "Ordered at" desc; limit 10
```

### Clause reference

| Clause | Purpose |
| --- | --- |
| `from table` / `from view` | Choose one readable source. Add `as alias` for a shorter or repeated source reference. |
| `join` / `left join` | Follow a relation to another readable table. |
| `select` | Choose, rename, or calculate output columns. Formulas and aggregates need an alias. |
| `where` | Filter source records before grouping. |
| `search` | Search all searchable fields, or named fields after `in`. |
| `group by` | Create one summary row per value or supported date bucket. |
| `aggregate` | Calculate `count`, `countEmpty`, `countUnique`, `sum`, `avg`, `min`, `max`, `median`, `earliest`, or `latest`. |
| `having` | Filter grouped rows after aggregates exist. |
| `sort` | Order rows or summaries; supports `asc`, `desc`, `nulls first`, and `nulls last`. |
| `limit` | Cap the complete logical result to 1–10,000 rows. |
| `offset` | Skip 0–10,000 rows before returning results. Always pair it with a meaningful sort. |
| `include deleted` | Include live and deleted records. |
| `deleted only` | Return only records in trash. |

The two deleted-record clauses are mutually exclusive. Normal queries return live records only.

### Names, aliases, and values

- Use readable table, view, and field names when they are unambiguous.
- Quote names containing spaces or punctuation with double quotes.
- Use single quotes for literal text.
- Use source aliases after joins, for example `customer.Name`.
- Use brace-wrapped UUIDs only when generated configuration or a migration needs an immutable reference.
- Do not use removed `#field` aliases.

When `from` is omitted in a table or view query editor, the current page can provide the source. Write it explicitly when the query should remain understandable outside that page.

### Conditions and helpers

Use `=`, `!=`, `>`, `>=`, `<`, and `<=` for comparisons. Combine conditions with `and`, `or`, `not`, and parentheses:

```gql
from table Inventory
where (Status = 'Available' or Status = 'Reserved') and Quantity > 0
sort Name asc
```

Do not write SQL function-style `AND(...)`, `OR(...)`, or `NOT(...)`.

Text helpers are `contains`, `startswith`, `endswith`, and the case-insensitive `icontains`, `istartswith`, and `iendswith`. Membership helpers support controlled and multi-value fields:

- `oneof(Field, 'a', 'b')`
- `noneof(Field, 'a', 'b')`
- `containsall(Field, 'a', 'b')`

Use `null` for a missing value. Sort missing values explicitly with `nulls first` or `nulls last` when their position matters.

A condition can also be a formula:

```gql
from table Products
where Price <= "Purchase price" * 1.10
select Name, Price, "Purchase price"
```

Open **Formulas** for expression syntax and the complete function catalog.

### Paging and result bounds

Without `limit`, a result view can continue through all matching rows using server cursors. With `limit 100`, the complete logical result stops after 100 rows even if the UI displays it in smaller pages.

Cursors are opaque, signed, and tied to the exact query and source. Changing the query starts at the first page. Pages are live reads rather than one frozen database snapshot, so concurrent changes can move records between requests.

For automated reads, the CLI can request one bounded page with `--page-size` or continue with `--all --max-rows N`.

### Permissions and execution

GQL is parsed, resolved against the visible schema, permission-checked, compiled to SQL, and executed on the server. Filtering, sorting, joins, grouping, and aggregation are not performed in the browser.

Every table, view, join, and relation target must be readable in the current context. Autocomplete follows the same rule and does not reveal hidden table or field names.

GQL deliberately refuses raw SQL features such as arbitrary join predicates, subqueries, common table expressions, window functions, and raw SQL expressions. A query that cannot be represented safely fails with a diagnostic.

### Views and query results

Row-shaped table and view results can be displayed and paged like records. Grouped and aggregate-only results use a summary table and are not editable. Compatible query results can be saved as views and reused by dashboards, documents, and exports.

Use a saved view when people revisit the result or it needs independent access. Keep GQL local to a dashboard widget or document when the query exists only for that resource.

### Troubleshoot a query

- **Unknown source or field:** Check spelling, quoting, current base, and access.
- **Ambiguous name:** Add a source alias or use a scoped field such as `customer.Name`.
- **Join must target an id:** Join the relation field to the joined alias's `.id`.
- **Grouped sort is rejected:** Sort by a group or aggregate output that exists in the summary.
- **Missing rows:** Check `where`, `search`, source view, deleted mode, and `limit`.
- **Unstable page order:** Add a business sort before paging or using `offset`.

:::note GQL is not a second data model
GQL shapes saved data. It does not copy records or bypass the access, field, and relation rules of the base.
:::
