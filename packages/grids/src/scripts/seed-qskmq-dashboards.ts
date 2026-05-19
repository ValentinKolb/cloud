/**
 * Seeds three demo dashboards for the QSKmq "Bookshop" base — one per
 * cell-kind emphasis so the new unified-row schema's full range is
 * visible at a glance:
 *
 *   1. "Sales overview" — KPI strip (with sparklines) + form + charts
 *   2. "Books catalog"  — chart-heavy with a view-stats cell
 *   3. "Operations"     — interactive: form + status stats + chart
 *
 * Run with: bun run packages/grids/src/scripts/seed-qskmq-dashboards.ts
 *
 * Idempotent: existing dashboards with the same name are deleted
 * first (soft delete via service) so re-running picks up edits.
 */
import { sql } from "bun";
import { gridsService } from "../service";
import type { DashboardConfig } from "../contracts";

// ─────────────────────────────────────────────────────────────────
// QSKmq base + table / field / view / form IDs (read from DB).
// Kept inline so this script is fully self-contained; the values
// only change if the user re-seeds the base from scratch with
// different ids.
// ─────────────────────────────────────────────────────────────────

const baseId = "75495133-2e95-4d1f-ac00-0fcd30c85226";
const actorId = "ffdb5e51-cb4a-4059-9307-781cfdf771f3";

const tables = {
  authors: "7d35ddee-b82e-45f2-ae98-dde860a49302",
  books: "933ed304-0a58-409b-a18d-ae755e70ea8d",
  customers: "05e03cc7-c7e8-4017-af17-fae12fa21ff0",
  genres: "992199a3-1019-43c7-be9d-68650c662c74",
  orders: "1e5b024c-7ed6-4848-9d8e-f6e565641688",
};

const fields = {
  // Orders
  orderLineTotal: "eaf28e27-c034-4535-bd39-c2866b85a240",
  orderDate: "475617b0-eb72-4d22-a8ba-afbbc2cf2416",
  orderStatus: "864bdad7-a33e-4ae3-94f7-700dd14c45cb",
  // Books
  bookPrice: "90c85227-947a-4f3c-8e75-7fd4bd794f19",
  bookPages: "da284279-9980-4641-b0ba-94fb9b09c73f",
  bookScore: "bceba169-a046-4a5d-8cf1-c6872cae38f8",
  bookInStock: "269a7005-0f72-41e6-957a-caa00dd22a3e",
  bookPublished: "551c6438-6d4e-4dae-a8db-dfe365039c70",
  // Customers
  customerJoined: "ee88013c-b836-4a58-82c6-9bf1f244dc70",
};

const views = {
  booksPerAuthor: "29cee6d6-1be1-4e39-803e-3375bd255ba4",
  byGenreRevenue: "924da00c-5617-4185-a877-5a58f3601156",
  recentBooks: "54436de0-ad1c-45e8-9749-ed309dc6ba2d",
  newestCustomers: "2895e9d9-595f-49ee-ba2d-52d49b37333c",
  ordersByMonth: "942881ca-53ef-4d4c-99d8-1a498cf792e7",
};

const forms = {
  newsletter: "0b156262-0c18-4a0b-bcbb-d61d73dd863a",
};

// ─────────────────────────────────────────────────────────────────
// Tiny ID helpers — widget IDs are client-generated stable strings
// so DnD / reorder tracking survives saves. Using `<prefix>_<n>` so
// the script's output is human-readable when inspecting the JSONB.
// ─────────────────────────────────────────────────────────────────

let widgetCounter = 0;
const wid = (prefix: string) => `${prefix}_${(++widgetCounter).toString(36)}`;
const rid = (n: number) => `r${n}`;

// ─────────────────────────────────────────────────────────────────
// Dashboard 1 — "Sales overview"
// ─────────────────────────────────────────────────────────────────
//
//  - Pure-stats row (auto-renders as a dense StatGrid):
//      Orders count (+ sparkline trend by month)
//      Revenue (currency, + sparkline trend by month)
//      Avg book price
//      Customers
//  - Mixed row: line chart "Orders by month" + newsletter form
//  - Mixed row: donut "By genre · revenue" + Newest-customers view
//
// Demonstrates: stat trends (sparkline below value), pure-stats
// auto-StatGrid layout, mixed cells in one row, chart-from-view,
// form embed with full-reload after submit, view embed with
// expanded relations.

const dashboardSales: DashboardConfig = {
  rows: [
    {
      id: rid(1),
      kind: "row",
      height: "sm",
      cells: [
        {
          id: wid("stat"),
          kind: "stat",
          title: "Orders",
          sub: "all-time",
          icon: "ti ti-shopping-cart",
          format: "integer",
          source: {
            tableId: tables.orders,
            aggregations: [{ fieldId: "*", agg: "count" }],
            trend: {
              fieldId: fields.orderDate,
              granularity: "month",
              windowSize: 12,
            },
          },
        },
        {
          id: wid("stat"),
          kind: "stat",
          title: "Revenue",
          sub: "line totals",
          icon: "ti ti-currency-euro",
          format: "currency",
          source: {
            tableId: tables.orders,
            aggregations: [{ fieldId: fields.orderLineTotal, agg: "sum" }],
            trend: {
              fieldId: fields.orderDate,
              granularity: "month",
              windowSize: 12,
            },
          },
        },
        {
          id: wid("stat"),
          kind: "stat",
          title: "Avg book price",
          sub: "all books",
          icon: "ti ti-tag",
          format: "currency",
          source: {
            tableId: tables.books,
            aggregations: [{ fieldId: fields.bookPrice, agg: "avg" }],
          },
        },
        {
          id: wid("stat"),
          kind: "stat",
          title: "Customers",
          sub: "registered",
          icon: "ti ti-users",
          format: "integer",
          source: {
            tableId: tables.customers,
            aggregations: [{ fieldId: "*", agg: "count" }],
          },
        },
      ],
    },
    {
      id: rid(2),
      kind: "row",
      height: "lg",
      cells: [
        {
          id: wid("chart"),
          kind: "chart",
          title: "Orders per month",
          subtitle: "count + revenue",
          chartType: "line",
          viewId: views.ordersByMonth,
          format: "integer",
        },
        {
          id: wid("form"),
          kind: "form",
          title: "Newsletter signup",
          formId: forms.newsletter,
        },
      ],
    },
    {
      id: rid(3),
      kind: "row",
      height: "lg",
      cells: [
        {
          id: wid("chart"),
          kind: "chart",
          title: "Revenue by genre",
          chartType: "donut",
          viewId: views.byGenreRevenue,
          format: "currency",
        },
        {
          id: wid("view"),
          kind: "view",
          title: "Newest customers",
          source: { kind: "view", viewId: views.newestCustomers },
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Dashboard 2 — "Books catalog"
// ─────────────────────────────────────────────────────────────────
//
//  - Pure-stats row (StatGrid): total / in-stock / avg-score / avg-pages
//  - Full-width bar chart row: Books per author
//  - Mixed row: view-stats cell (auto-derived from "By genre · revenue"
//    view's first bucket → 2×N internal grid) + recent books view
//
// Demonstrates: view-stats cell shape (auto 2×N inside one paper),
// chart filling a row by itself, mixing stat-derived + raw-table
// content in one row.

const dashboardCatalog: DashboardConfig = {
  rows: [
    {
      id: rid(1),
      kind: "row",
      height: "sm",
      cells: [
        {
          id: wid("stat"),
          kind: "stat",
          title: "Books",
          sub: "total titles",
          icon: "ti ti-books",
          format: "integer",
          source: {
            tableId: tables.books,
            aggregations: [{ fieldId: "*", agg: "count" }],
          },
        },
        {
          id: wid("stat"),
          kind: "stat",
          title: "In stock",
          sub: "available now",
          icon: "ti ti-package",
          format: "integer",
          source: {
            tableId: tables.books,
            aggregations: [{ fieldId: fields.bookInStock, agg: "count" }],
          },
        },
        {
          id: wid("stat"),
          kind: "stat",
          title: "Avg score",
          sub: "across catalog",
          icon: "ti ti-star",
          format: "plain",
          source: {
            tableId: tables.books,
            aggregations: [{ fieldId: fields.bookScore, agg: "avg" }],
          },
        },
        {
          id: wid("stat"),
          kind: "stat",
          title: "Avg pages",
          sub: "per book",
          icon: "ti ti-file-text",
          format: "integer",
          source: {
            tableId: tables.books,
            aggregations: [{ fieldId: fields.bookPages, agg: "avg" }],
          },
        },
      ],
    },
    {
      id: rid(2),
      kind: "row",
      height: "lg",
      cells: [
        {
          id: wid("chart"),
          kind: "chart",
          title: "Books per author",
          subtitle: "count + total pages",
          chartType: "bar",
          viewId: views.booksPerAuthor,
          format: "integer",
        },
      ],
    },
    {
      id: rid(3),
      kind: "row",
      height: "lg",
      cells: [
        {
          id: wid("viewstats"),
          kind: "view-stats",
          title: "Top genre snapshot",
          viewId: views.byGenreRevenue,
        },
        {
          id: wid("view"),
          kind: "view",
          title: "Recent books (2000+)",
          source: { kind: "view", viewId: views.recentBooks },
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Dashboard 3 — "Operations"
// ─────────────────────────────────────────────────────────────────
//
//  - Mixed row: stat (Orders this month, with trend) + form
//    (newsletter signup) + view (newest customers)
//  - Full-width line chart: Orders per month
//  - Pure-stats row: book stock summary
//
// Demonstrates: form cell as primary affordance next to KPIs,
// stat + form + view in a single mixed row (auto-paper-card layout
// because not pure-stat), full-width chart, sparkline trends.

const dashboardOps: DashboardConfig = {
  rows: [
    {
      id: rid(1),
      kind: "row",
      height: "lg",
      cells: [
        {
          id: wid("stat"),
          kind: "stat",
          title: "Total orders",
          sub: "all time",
          icon: "ti ti-shopping-cart",
          format: "integer",
          source: {
            tableId: tables.orders,
            aggregations: [{ fieldId: "*", agg: "count" }],
            trend: {
              fieldId: fields.orderDate,
              granularity: "month",
              windowSize: 12,
            },
          },
        },
        {
          id: wid("form"),
          kind: "form",
          title: "Customer signup",
          formId: forms.newsletter,
        },
        {
          id: wid("view"),
          kind: "view",
          title: "Newest customers",
          source: { kind: "view", viewId: views.newestCustomers },
        },
      ],
    },
    {
      id: rid(2),
      kind: "row",
      height: "lg",
      cells: [
        {
          id: wid("chart"),
          kind: "chart",
          title: "Orders per month",
          subtitle: "last 12 months",
          chartType: "line",
          viewId: views.ordersByMonth,
          limit: 12,
          format: "integer",
        },
      ],
    },
    {
      id: rid(3),
      kind: "row",
      height: "sm",
      cells: [
        {
          id: wid("stat"),
          kind: "stat",
          title: "Catalog",
          sub: "titles in catalog",
          icon: "ti ti-books",
          format: "integer",
          source: {
            tableId: tables.books,
            aggregations: [{ fieldId: "*", agg: "count" }],
          },
        },
        {
          id: wid("stat"),
          kind: "stat",
          title: "In stock",
          sub: "available now",
          icon: "ti ti-package",
          format: "integer",
          source: {
            tableId: tables.books,
            aggregations: [{ fieldId: fields.bookInStock, agg: "count" }],
          },
        },
        {
          id: wid("stat"),
          kind: "stat",
          title: "Books published 2000+",
          sub: "modern titles",
          icon: "ti ti-calendar",
          format: "integer",
          source: {
            tableId: tables.books,
            aggregations: [{ fieldId: "*", agg: "count" }],
          },
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Idempotent re-seed: hard-delete any existing dashboards with the
// same name on this base, then create fresh ones. Hard delete is
// fine here — these are demo configs the script owns end-to-end.
// ─────────────────────────────────────────────────────────────────

const dashboards = [
  { name: "Sales overview", description: "KPIs, recent activity, and the newsletter signup.", config: dashboardSales },
  { name: "Books catalog", description: "Catalog stats, books-per-author breakdown, and a recent-titles view.", config: dashboardCatalog },
  { name: "Operations", description: "Daily ops — incoming orders, customer signups, monthly trend.", config: dashboardOps },
];

const main = async () => {
  console.log(`Seeding ${dashboards.length} demo dashboards on QSKmq…`);

  // Hard-delete any existing dashboards by name (and their access
  // rows) so re-running this script doesn't accumulate copies.
  for (const d of dashboards) {
    const deleted = await sql`
      DELETE FROM grids.dashboards
      WHERE base_id = ${baseId}::uuid
        AND name = ${d.name}
      RETURNING id
    `;
    if (deleted.length > 0) {
      console.log(`  dropped ${deleted.length} existing "${d.name}" dashboard(s)`);
    }
  }

  for (const d of dashboards) {
    const res = await gridsService.dashboard.create(
      {
        baseId,
        name: d.name,
        description: d.description,
        config: d.config,
        ownerUserId: null /* shared with the base */,
      },
      actorId,
    );
    if (!res.ok) {
      throw new Error(`dashboard.create "${d.name}": ${res.error.message}`);
    }
    console.log(`  ✓ ${res.data.name}  (slug=${res.data.shortId})`);
  }

  console.log("");
  console.log(`open: /app/grids/QSKmq`);
  await sql.end();
};

await main();
