/**
 * Seeds a focused formula demo base for user `lol`.
 *
 * Usage:
 *   bun run packages/grids/src/scripts/seed-lol-formula-lab.ts
 *
 * Creates a fresh "Formula Lab <timestamp>" base each run. This keeps
 * the script safe while the app is in alpha: no migrations, no
 * destructive cleanup, no hidden reuse.
 */
import { sql } from "bun";
import type { ColumnSpec, DashboardConfig, Field } from "../service";
import { gridsService } from "../service";

const LOL_UID = "lol";

const log = (msg: string) => console.log(`  ${msg}`);
const must = async <T>(label: string, result: Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>): Promise<T> => {
  const resolved = await result;
  if (!resolved.ok) throw new Error(`${label}: ${resolved.error.message}`);
  return resolved.data;
};

const ref = (field: Field) => `#${field.shortId}`;

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

const main = async () => {
  const [user] = await sql<{ id: string; display_name: string | null }[]>`
    SELECT id, display_name FROM auth.users WHERE uid = ${LOL_UID}
  `;
  if (!user) throw new Error(`User "${LOL_UID}" not found`);
  const actor = user.id;
  console.log(`Seeding Formula Lab for ${user.display_name ?? LOL_UID} (${actor})`);

  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const base = await must(
    "base.create",
    gridsService.base.create(
      {
        name: `Formula Lab ${ts}`,
        description: "Formula showcase: exact decimals, text helpers, dates, boolean logic, error handling, and progress formatting.",
      },
      actor,
    ),
  );
  log(`base ${base.shortId} (${base.id})`);

  const table = await must(
    "table.create",
    gridsService.table.create(
      {
        baseId: base.id,
        name: "Formula invoices",
        description: "Synthetic but realistic invoice rows with many computed formula columns.",
        icon: "ti ti-calculator",
      },
      actor,
    ),
  );
  log(`table ${table.shortId} (${table.id})`);

  const mkField = async (name: string, type: string, config: Record<string, unknown> = {}, extras: Partial<Field> = {}) =>
    must(
      `field.create ${name}`,
      gridsService.field.create(
        {
          tableId: table.id,
          name,
          type,
          config,
          description: extras.description ?? null,
          icon: extras.icon ?? null,
          required: extras.required ?? false,
          presentable: extras.presentable ?? false,
          hideInTable: extras.hideInTable ?? false,
          defaultValue: extras.defaultValue ?? null,
          indexed: extras.indexed ?? false,
          uniqueConstraint: extras.uniqueConstraint ?? false,
        },
        actor,
      ),
    );

  const F_CUSTOMER = await mkField("Customer", "text", { maxLength: 120 }, { presentable: true, required: true });
  const F_REGION = await mkField("Region", "text", { maxLength: 40 }, { required: true });
  const F_INVOICE_DATE = await mkField("Invoice date", "date", {}, { required: true });
  const F_DUE_DATE = await mkField("Due date", "date", {}, { required: true });
  const F_UNITS = await mkField("Units", "number", { min: 0, integerOnly: true }, { required: true });
  const F_UNIT_PRICE = await mkField(
    "Unit price",
    "number",
    { precision: 16, decimalPlaces: 2, unit: "EUR", unitPosition: "suffix" },
    { required: true },
  );
  const F_UNIT_COST = await mkField(
    "Unit cost",
    "number",
    { precision: 16, decimalPlaces: 2, unit: "EUR", unitPosition: "suffix" },
    { required: true },
  );
  const F_DISCOUNT = await mkField("Discount", "percent", { range: "fraction", decimals: 2 });
  const F_PAID = await mkField("Amount paid", "number", { precision: 16, decimalPlaces: 2, unit: "EUR", unitPosition: "suffix" });
  const F_ACTIVE = await mkField("Active", "boolean", {}, { defaultValue: true });
  const F_NOTES = await mkField("Notes", "longtext", { markdown: true });

  const formula = (name: string, expression: string, extras: Partial<Field> = {}) => mkField(name, "formula", { expression }, extras);

  const F_SUBTOTAL = await formula("Subtotal", `${ref(F_UNITS)} * ${ref(F_UNIT_PRICE)}`);
  const F_DISCOUNT_AMOUNT = await formula("Discount amount", `${ref(F_SUBTOTAL)} * ${ref(F_DISCOUNT)}`);
  const F_NET = await formula("Net revenue", `${ref(F_SUBTOTAL)} - ${ref(F_DISCOUNT_AMOUNT)}`);
  const F_TAX = await formula("Tax 19%", `ROUND(${ref(F_NET)} * 0.19, 2)`);
  const F_GROSS = await formula("Gross total", `${ref(F_NET)} + ${ref(F_TAX)}`);
  const F_UNIT_PROFIT = await formula("Unit profit", `${ref(F_UNIT_PRICE)} - ${ref(F_UNIT_COST)}`);
  const F_PROFIT = await formula("Profit", `(${ref(F_UNIT_PRICE)} - ${ref(F_UNIT_COST)}) * ${ref(F_UNITS)} - ${ref(F_DISCOUNT_AMOUNT)}`);
  const F_MARGIN = await formula("Margin progress", `IFERROR(${ref(F_PROFIT)} / ${ref(F_NET)}, 0)`);
  const F_PAYMENT_PROGRESS = await formula("Payment progress", `IFERROR(${ref(F_PAID)} / ${ref(F_GROSS)}, 0)`);
  const F_PAYMENT_LABEL = await formula(
    "Payment label",
    `IF(${ref(F_PAID)} >= ${ref(F_GROSS)}, "Paid", IF(${ref(F_PAID)} = 0, "Open", "Partial"))`,
  );
  const F_ACCOUNT_LABEL = await formula("Account label", `CONCAT(UPPER(${ref(F_CUSTOMER)}), " - ", ${ref(F_REGION)})`);
  const F_CLEAN_NOTES = await formula("Clean notes", `TRIM(REPLACE(${ref(F_NOTES)}, "urgent", "priority"))`);
  const F_CODE = await formula(
    "Invoice code",
    `CONCAT(LEFT(${ref(F_CUSTOMER)}, 3), "-", YEAR(${ref(F_INVOICE_DATE)}), "-", ${ref(F_UNITS)})`,
  );
  const F_TERM_DAYS = await formula("Payment term days", `DATEDIFF(${ref(F_INVOICE_DATE)}, ${ref(F_DUE_DATE)}, "days")`);
  const F_DAYS_UNTIL_DUE = await formula("Days until due", `DATEDIFF(TODAY(), ${ref(F_DUE_DATE)}, "days")`);
  const F_DUE_STATUS = await formula(
    "Due status",
    `IF(${ref(F_PAYMENT_PROGRESS)} >= 1, "Paid", IF(${ref(F_DUE_DATE)} < TODAY(), "Overdue", "Open"))`,
  );
  const F_REVIEW_DATE = await formula("Review date", `DATEADD(${ref(F_INVOICE_DATE)}, 14, "days")`);
  const F_INVOICE_MONTH = await formula("Invoice month", `CONCAT(YEAR(${ref(F_INVOICE_DATE)}), "-", MONTH(${ref(F_INVOICE_DATE)}))`);
  const F_LARGE_ORDER = await formula("Large active order", `AND(${ref(F_ACTIVE)}, ${ref(F_GROSS)} > 500, ${ref(F_UNITS)} >= 5)`);
  const F_SAFE_DIVISION = await formula(
    "Safe division demo",
    `IFERROR(${ref(F_GROSS)} / (${ref(F_UNITS)} - ${ref(F_UNITS)}), "caught div/0")`,
  );
  const F_TEXT_SCORE = await formula("Text score", `LEN(${ref(F_CUSTOMER)}) + COUNT(${ref(F_NOTES)}, ${ref(F_REGION)})`);

  const fields = [
    F_CUSTOMER,
    F_REGION,
    F_INVOICE_DATE,
    F_DUE_DATE,
    F_UNITS,
    F_UNIT_PRICE,
    F_UNIT_COST,
    F_DISCOUNT,
    F_PAID,
    F_ACTIVE,
    F_NOTES,
    F_SUBTOTAL,
    F_DISCOUNT_AMOUNT,
    F_NET,
    F_TAX,
    F_GROSS,
    F_UNIT_PROFIT,
    F_PROFIT,
    F_MARGIN,
    F_PAYMENT_PROGRESS,
    F_PAYMENT_LABEL,
    F_ACCOUNT_LABEL,
    F_CLEAN_NOTES,
    F_CODE,
    F_TERM_DAYS,
    F_DAYS_UNTIL_DUE,
    F_DUE_STATUS,
    F_REVIEW_DATE,
    F_INVOICE_MONTH,
    F_LARGE_ORDER,
    F_SAFE_DIVISION,
    F_TEXT_SCORE,
  ];
  log(`fields x ${fields.length}`);

  const columns: ColumnSpec[] = [
    { fieldId: F_CUSTOMER.id },
    { fieldId: F_REGION.id },
    { fieldId: F_INVOICE_DATE.id, format: { kind: "date", format: "short" } },
    { fieldId: F_DUE_DATE.id, format: { kind: "date", format: "relative" } },
    { fieldId: F_UNITS.id },
    { fieldId: F_UNIT_PRICE.id, format: { kind: "decimal", precision: 2, thousandsSeparator: true } },
    { fieldId: F_DISCOUNT.id, format: { kind: "percent", precision: 0 } },
    { fieldId: F_SUBTOTAL.id, format: { kind: "decimal", precision: 2, thousandsSeparator: true } },
    { fieldId: F_NET.id, format: { kind: "decimal", precision: 2, thousandsSeparator: true } },
    { fieldId: F_GROSS.id, format: { kind: "decimal", precision: 2, thousandsSeparator: true } },
    { fieldId: F_PROFIT.id, format: { kind: "decimal", precision: 2, thousandsSeparator: true } },
    { fieldId: F_MARGIN.id, format: { kind: "progress", label: "percent" } },
    { fieldId: F_PAYMENT_PROGRESS.id, format: { kind: "progress", label: "percent" } },
    { fieldId: F_PAYMENT_LABEL.id },
    { fieldId: F_DUE_STATUS.id },
    { fieldId: F_ACCOUNT_LABEL.id },
    { fieldId: F_REVIEW_DATE.id, format: { kind: "date", format: "short" } },
    { fieldId: F_SAFE_DIVISION.id },
  ];
  await must("table.update columns", gridsService.table.update(table.id, { columns }, actor));

  const rows: Array<Record<string, unknown>> = [
    {
      [F_CUSTOMER.id]: "Acme Office",
      [F_REGION.id]: "DACH",
      [F_INVOICE_DATE.id]: "2026-05-01",
      [F_DUE_DATE.id]: "2026-05-15",
      [F_UNITS.id]: 8,
      [F_UNIT_PRICE.id]: "129.90",
      [F_UNIT_COST.id]: "71.25",
      [F_DISCOUNT.id]: 0.1,
      [F_PAID.id]: "600.00",
      [F_ACTIVE.id]: true,
      [F_NOTES.id]: "urgent onboarding package",
    },
    {
      [F_CUSTOMER.id]: "Northwind Traders",
      [F_REGION.id]: "EMEA",
      [F_INVOICE_DATE.id]: "2026-05-08",
      [F_DUE_DATE.id]: "2026-06-07",
      [F_UNITS.id]: 3,
      [F_UNIT_PRICE.id]: "249.50",
      [F_UNIT_COST.id]: "160.00",
      [F_DISCOUNT.id]: 0,
      [F_PAID.id]: "0.00",
      [F_ACTIVE.id]: true,
      [F_NOTES.id]: "New logo rollout",
    },
    {
      [F_CUSTOMER.id]: "Globex Retail",
      [F_REGION.id]: "US",
      [F_INVOICE_DATE.id]: "2026-04-20",
      [F_DUE_DATE.id]: "2026-05-20",
      [F_UNITS.id]: 12,
      [F_UNIT_PRICE.id]: "89.99",
      [F_UNIT_COST.id]: "52.30",
      [F_DISCOUNT.id]: 0.05,
      [F_PAID.id]: "1220.00",
      [F_ACTIVE.id]: true,
      [F_NOTES.id]: "priority renewal",
    },
    {
      [F_CUSTOMER.id]: "Initech Labs",
      [F_REGION.id]: "DACH",
      [F_INVOICE_DATE.id]: "2026-05-18",
      [F_DUE_DATE.id]: "2026-06-01",
      [F_UNITS.id]: 1,
      [F_UNIT_PRICE.id]: "999.99",
      [F_UNIT_COST.id]: "810.15",
      [F_DISCOUNT.id]: 0.15,
      [F_PAID.id]: "500.00",
      [F_ACTIVE.id]: false,
      [F_NOTES.id]: "Trial conversion",
    },
    {
      [F_CUSTOMER.id]: "Umbrella Health",
      [F_REGION.id]: "EMEA",
      [F_INVOICE_DATE.id]: "2026-03-12",
      [F_DUE_DATE.id]: "2026-04-11",
      [F_UNITS.id]: 25,
      [F_UNIT_PRICE.id]: "19.95",
      [F_UNIT_COST.id]: "8.40",
      [F_DISCOUNT.id]: 0.2,
      [F_PAID.id]: "0.00",
      [F_ACTIVE.id]: true,
      [F_NOTES.id]: "urgent batch order",
    },
    {
      [F_CUSTOMER.id]: "Soylent Services",
      [F_REGION.id]: "APAC",
      [F_INVOICE_DATE.id]: "2026-05-19",
      [F_DUE_DATE.id]: "2026-05-19",
      [F_UNITS.id]: 0,
      [F_UNIT_PRICE.id]: "120.00",
      [F_UNIT_COST.id]: "60.00",
      [F_DISCOUNT.id]: 0,
      [F_PAID.id]: "0.00",
      [F_ACTIVE.id]: true,
      [F_NOTES.id]: "Zero-unit edge case",
    },
  ];
  for (const row of rows) {
    await must("record.create", gridsService.record.create(table.id, row, actor));
  }
  log(`records x ${rows.length}`);

  const formulaView = await must(
    "view.create Formula outputs",
    gridsService.view.create(
      {
        tableId: table.id,
        name: "Formula outputs",
        icon: "ti ti-function",
        ownerUserId: null,
        query: {
          columns,
          sort: [{ fieldId: F_INVOICE_DATE.id, direction: "desc" }],
        },
      },
      actor,
    ),
  );
  const progressView = await must(
    "view.create Payment progress",
    gridsService.view.create(
      {
        tableId: table.id,
        name: "Payment progress",
        icon: "ti ti-progress",
        ownerUserId: null,
        query: {
          columns: [
            { fieldId: F_CUSTOMER.id },
            { fieldId: F_GROSS.id, format: { kind: "decimal", precision: 2, thousandsSeparator: true } },
            { fieldId: F_PAID.id, format: { kind: "decimal", precision: 2, thousandsSeparator: true } },
            { fieldId: F_PAYMENT_PROGRESS.id, format: { kind: "progress", label: "percent" } },
            { fieldId: F_PAYMENT_LABEL.id },
            { fieldId: F_DUE_STATUS.id },
          ],
          sort: [{ fieldId: F_DUE_DATE.id, direction: "asc" }],
        },
      },
      actor,
    ),
  );
  const regionView = await must(
    "view.create Paid by region",
    gridsService.view.create(
      {
        tableId: table.id,
        name: "Paid by region",
        icon: "ti ti-chart-bar",
        ownerUserId: null,
        query: {
          groupBy: [{ fieldId: F_REGION.id, direction: "asc" }],
          aggregations: [
            { fieldId: "*", agg: "count" },
            { fieldId: F_PAID.id, agg: "sum", label: "Paid total", format: { kind: "decimal", precision: 2, thousandsSeparator: true } },
            { fieldId: F_UNIT_PRICE.id, agg: "avg", label: "Avg unit price", format: { kind: "decimal", precision: 2 } },
          ],
        },
      },
      actor,
    ),
  );
  log("views x 3");

  const dashboardConfig: DashboardConfig = {
    rows: [
      {
        id: "formula-lab-intro",
        kind: "row",
        height: "md",
        cells: [
          {
            id: "formula-lab-notes",
            kind: "markdown",
            span: 6,
            title: "Formula Lab",
            markdown: [
              "## What to inspect",
              "",
              "- Formula fields use `#shortId` refs.",
              "- Decimal formulas avoid float drift.",
              "- Progress columns come from formula values.",
              "- Date formulas use local date strings, not timezone shifts.",
              "- `IFERROR` catches division by zero.",
            ].join("\n"),
          },
          {
            id: "formula-lab-link",
            kind: "link",
            span: 3,
            title: "Open formula view",
            description: "Jump to the table view with all computed columns.",
            icon: "ti ti-function",
            target: { kind: "view", viewId: formulaView.id },
          },
          {
            id: "formula-lab-progress-link",
            kind: "link",
            span: 3,
            title: "Open progress view",
            description: "Check progress-bar formatting on formula columns.",
            icon: "ti ti-progress",
            target: { kind: "view", viewId: progressView.id },
          },
        ],
      },
      {
        id: "formula-lab-stats",
        kind: "row",
        height: "sm",
        cells: [
          {
            id: "stat-invoices",
            kind: "stat",
            title: "Invoices",
            sub: "records",
            icon: "ti ti-receipt",
            tone: "blue",
            format: "integer",
            source: { tableId: table.id, aggregations: [{ fieldId: "*", agg: "count" }] },
          },
          {
            id: "stat-paid",
            kind: "stat",
            title: "Paid",
            sub: "raw amount paid",
            icon: "ti ti-currency-euro",
            tone: "green",
            format: "currency",
            source: { tableId: table.id, aggregations: [{ fieldId: F_PAID.id, agg: "sum" }] },
          },
          {
            id: "stat-units",
            kind: "stat",
            title: "Units",
            sub: "total",
            icon: "ti ti-package",
            tone: "neutral",
            format: "integer",
            source: { tableId: table.id, aggregations: [{ fieldId: F_UNITS.id, agg: "sum" }] },
          },
        ],
      },
      {
        id: "formula-lab-main",
        kind: "row",
        height: "lg",
        cells: [
          {
            id: "chart-paid-region",
            kind: "chart",
            span: 5,
            title: "Paid by region",
            subtitle: "Grouped view, SQL aggregation",
            chartType: "bar",
            viewId: regionView.id,
            format: "currency",
          },
          {
            id: "view-progress",
            kind: "view",
            span: 7,
            title: "Payment progress",
            source: { kind: "view", viewId: progressView.id },
          },
        ],
      },
    ],
  };

  const dashboard = await must(
    "dashboard.create",
    gridsService.dashboard.create(
      {
        baseId: base.id,
        name: "Formula Lab overview",
        description: "Dashboard for inspecting formula output and progress formatting.",
        icon: "ti ti-function",
        ownerUserId: null,
        config: dashboardConfig,
      },
      actor,
    ),
  );
  await must("base.update default dashboard", gridsService.base.update(base.id, { defaultDashboardId: dashboard.id }, actor));
  log(`dashboard ${dashboard.shortId} (${dashboard.id})`);

  const listed = await must(
    "record.list verify",
    gridsService.record.list({
      tableId: table.id,
      limit: 10,
      sort: [{ fieldId: F_INVOICE_DATE.id, direction: "asc" }],
    }),
  );
  const sample = listed.items[0]?.data ?? {};
  const requiredOutputs = [F_GROSS, F_MARGIN, F_PAYMENT_LABEL, F_DUE_STATUS, F_SAFE_DIVISION];
  for (const field of requiredOutputs) {
    if (!(field.id in sample)) throw new Error(`verification failed: missing formula output "${field.name}"`);
  }
  log(`verified sample gross=${sample[F_GROSS.id]}, margin=${sample[F_MARGIN.id]}, payment=${sample[F_PAYMENT_LABEL.id]}`);

  console.log("");
  console.log("Formula Lab seeded.");
  console.log(`  base:      /app/grids/${base.shortId}`);
  console.log(`  dashboard: /app/grids/${base.shortId}/dashboard/${dashboard.shortId}`);
  console.log(`  table:     /app/grids/${base.shortId}/table/${table.shortId}`);
  console.log(`  formula view id: ${formulaView.shortId}`);
  console.log(`  generated on: ${todayIsoDate()}`);
};

try {
  await main();
} finally {
  await sql.end();
}
