# DataTable

`DataTable` renders typed rows and columns. The server owns filtering, sorting, pagination, aggregation, and permission checks; the component owns table presentation and row interaction.

## Use DataTable

Use it for records with consistent fields, comparable values, and column headings.

Use `StructuredDataPreview` for one small metadata object. Use `DataPanel` when the table also needs a title, count, search, filters, loading state, or pagination.

## Import

```tsx
import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from "@valentinkolb/cloud/ui";
```

## Rows and columns

Each column has a stable `id`, a `header`, and usually a `value` key or function. Numeric values align right by default. `renderCell` and `renderHeader` customize presentation without changing the underlying row model.

Pass `getRowId` when selection or stable row identity matters. Use `selectedRowId` for a selected record, not the row index.

The default cell renderer displays missing values as an em dash, dates with the current locale, and booleans as Yes or No.

## Sorting and filtering

Mark a column `sortable: true`, or provide the server's sort key as a string. Pass the current `sort` and build a URL in `sortHref`.

Sorting is link-based so it works on a cold server render and survives reload, sharing, and browser navigation. The same rule applies to filters and pagination: put user intent in the URL, query the server, then pass the returned rows to the table.

Do not filter or sort a paginated result in the browser. The client does not own the complete dataset.

## Presentation

Use `density="compact"` for dense operational tables. Headers are sticky unless `stickyHeader={false}`. `footer` accepts values and an optional cell renderer for server-computed totals.

`hasMore`, `loadingMore`, and `onLoadMore` add an infinite-load sentinel. The owning island still fetches the next server page and appends its rows.

## Accessibility

Sortable headers expose `aria-sort`. Interactive rows receive keyboard focus and activate with Enter or Space.

Do not make an entire row interactive when it contains unrelated controls. Give action columns an accessible heading, including a visually hidden one when the design does not show text.

## Runtime

Rows, headers, sort links, selection, empty state, and footer render on the server. Row callbacks, column hover, and infinite loading require hydration.

Prefer normal links for navigation. Use callbacks only when the interaction cannot be represented by a URL.

## Example

```tsx
type RouteRow = {
  id: string;
  path: string;
  requests: number;
};

const columns: DataTableColumn<RouteRow>[] = [
  { id: "path", header: "Route", value: "path", sortable: true },
  {
    id: "requests",
    header: "Requests",
    value: "requests",
    sortable: "requestCount",
  },
];

<DataTable
  rows={rows}
  columns={columns}
  getRowId={(row) => row.id}
  sort={{ key: "requestCount", direction: "desc" }}
  sortHref={(next) =>
    `/admin/routes?sort=${next.key}&direction=${next.direction}`
  }
/>
```
