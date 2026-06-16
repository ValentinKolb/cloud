import { describe, expect, test } from "bun:test";
import { parseDataUrl } from "@valentinkolb/cloud/shared";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { templates } from ".";
import { field, formula } from "./types";
import type { GridTemplate, TemplateDateExpression, TemplateRef } from "./types";

const isRef = (value: unknown): value is TemplateRef =>
  !!value &&
  typeof value === "object" &&
  typeof (value as Record<string, unknown>).$ref === "string" &&
  typeof (value as Record<string, unknown>).key === "string";

const isCurrentMonthDate = (value: unknown): value is TemplateDateExpression =>
  !!value && typeof value === "object" && (value as { $date?: unknown }).$date === "current_month";

const isFormulaExpression = (value: unknown): value is { $formula: Array<string | TemplateRef> } =>
  !!value && typeof value === "object" && Array.isArray((value as { $formula?: unknown }).$formula);

const refsIn = (value: unknown): TemplateRef[] => {
  if (isRef(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(refsIn);
  return [];
};

const indexTemplate = (template: GridTemplate) => {
  const tables = new Set(template.tables.map((table) => table.key));
  const fields = new Set(template.tables.flatMap((table) => table.fields.map((field) => `${table.key}.${field.key}`)));
  const records = new Set((template.records ?? []).map((record) => record.key));
  const views = new Set((template.views ?? []).map((view) => view.key));
  const forms = new Set((template.forms ?? []).map((form) => form.key));
  const dashboards = new Set((template.dashboards ?? []).map((dashboard) => dashboard.key));
  return { tables, fields, records, views, forms, dashboards };
};

const assertUnique = (values: string[], label: string) => {
  expect(new Set(values).size, `${label} must be unique`).toBe(values.length);
};

const dashboardCells = (template: GridTemplate) =>
  (template.dashboards ?? []).flatMap((dashboard) => {
    const rows = (dashboard.config as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      const cells = (row as { cells?: unknown }).cells;
      return Array.isArray(cells) ? (cells as Array<Record<string, unknown>>) : [];
    });
  });

const GQL_RESERVED_REFS = new Set([
  "aggregate",
  "and",
  "as",
  "by",
  "deleted",
  "false",
  "first",
  "from",
  "group",
  "having",
  "include",
  "join",
  "last",
  "left",
  "limit",
  "not",
  "null",
  "nulls",
  "offset",
  "on",
  "only",
  "or",
  "search",
  "select",
  "sort",
  "table",
  "true",
  "view",
  "where",
]);

const gqlRef = (name: string): string => {
  const trimmed = name.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) && !GQL_RESERVED_REFS.has(trimmed.toLowerCase())) return trimmed;
  return `"${trimmed.replaceAll('"', '""')}"`;
};

const templateNamesForGql = (template: GridTemplate) => {
  const tables = new Map<string, string>();
  const fields = new Map<string, string>();
  for (const table of template.tables) {
    tables.set(table.key, table.name);
    for (const field of table.fields) fields.set(`${table.key}.${field.key}`, field.name);
  }
  return { tables, fields };
};

const resolveTemplateGqlValue = (value: unknown, names: ReturnType<typeof templateNamesForGql>): unknown => {
  if (isRef(value)) {
    const resolved = value.$ref === "table" ? names.tables.get(value.key) : value.$ref === "field" ? names.fields.get(value.key) : undefined;
    if (!resolved) throw new Error(`unsupported GQL template ref ${value.$ref}:${value.key}`);
    return gqlRef(resolved);
  }
  if (isFormulaExpression(value)) {
    return value.$formula.map((part) => (typeof part === "string" ? part : resolveTemplateGqlValue(part, names))).join("");
  }
  if (Array.isArray(value)) return value.map((item) => resolveTemplateGqlValue(item, names));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, resolveTemplateGqlValue(nested, names)]));
  }
  return value;
};

describe("built-in grid templates", () => {
  test("template ids are unique", () => {
    assertUnique(
      templates.map((template) => template.id),
      "template ids",
    );
  });

  test("bookshop template is named without inventory suffix", () => {
    const bookshop = templates.find((template) => template.id === "bookshop");
    expect(bookshop?.name).toBe("Bookshop");
  });

  test("finance merchant QR column targets merchant websites", () => {
    const finance = templates.find((template) => template.id === "finance");
    expect(finance, "finance template").toBeDefined();
    if (!finance) return;

    const transactions = finance.tables.find((table) => table.key === "transactions");
    const merchants = finance.tables.find((table) => table.key === "merchants");
    const merchantWebsite = transactions?.fields.find((field) => field.key === "merchant_website");
    const website = merchants?.fields.find((field) => field.key === "website");
    expect(merchantWebsite?.type).toBe("lookup");
    expect(website?.type).toBe("text");
    expect((merchantWebsite?.config as { targetFieldId?: unknown } | undefined)?.targetFieldId).toEqual(field("merchants.website"));

    const recentTransactions = finance.views?.find((view) => view.key === "recent_transactions");
    const columns = (recentTransactions?.ui as { columns?: Array<Record<string, unknown>> } | undefined)?.columns ?? [];
    const qrColumn = columns.find(
      (column) => column.fieldId && isRef(column.fieldId) && column.fieldId.key === "transactions.merchant_website",
    );
    expect(qrColumn?.label).toBe("Merchant QR");
    expect(qrColumn?.format).toEqual({ kind: "barcode", bcid: "qrcode" });

    const merchantRecords = (finance.records ?? []).filter((record) => record.table === "merchants");
    expect(merchantRecords.length).toBeGreaterThan(0);
    for (const record of merchantRecords) {
      expect(String(record.values.website ?? "")).toMatch(/^https?:\/\//);
    }
  });

  test("inventory template exposes asset id as a barcode field", () => {
    const inventory = templates.find((template) => template.id === "inventory");
    expect(inventory, "inventory template").toBeDefined();
    if (!inventory) return;

    const items = inventory.tables.find((table) => table.key === "items");
    const barcode = items?.fields.find((field) => field.key === "asset_barcode");
    expect(barcode?.type).toBe("formula");
    expect(barcode?.hideInTable).not.toBe(true);
    expect((barcode?.config as { expression?: unknown } | undefined)?.expression).toEqual(formula(field("items.asset_id")));
    expect((barcode?.config as { format?: unknown } | undefined)?.format).toEqual({ kind: "barcode", bcid: "code128", showText: true });

    const availableItems = inventory.views?.find((view) => view.key === "available_items");
    const columns = (availableItems?.ui as { columns?: Array<Record<string, unknown>> } | undefined)?.columns ?? [];
    const firstColumn = columns[0];
    expect(firstColumn?.fieldId).toEqual(field("items.asset_barcode"));
    expect(firstColumn?.label).toBe("asset_id");
    expect(firstColumn?.format).toEqual({ kind: "barcode", bcid: "code128", showText: true });
  });

  test("card and calendar template examples are backed by real fields", () => {
    const bookshop = templates.find((template) => template.id === "bookshop");
    const inventory = templates.find((template) => template.id === "inventory");
    const finance = templates.find((template) => template.id === "finance");

    const books = bookshop?.tables.find((table) => table.key === "books");
    const items = inventory?.tables.find((table) => table.key === "items");
    expect((books?.displayConfig as { mode?: unknown } | undefined)?.mode).toBe("cards");
    expect((items?.displayConfig as { mode?: unknown } | undefined)?.mode).toBe("cards");

    expect((books?.displayConfig as { cards?: { imageFieldId?: unknown } } | undefined)?.cards?.imageFieldId).toEqual(field("books.cover"));
    expect((items?.displayConfig as { cards?: { imageFieldId?: unknown } } | undefined)?.cards?.imageFieldId).toEqual(field("items.files"));

    const bookCovers = (bookshop?.records ?? []).flatMap((record) => record.files ?? []);
    const inventoryCovers = (inventory?.records ?? []).flatMap((record) => record.files ?? []);
    expect(bookCovers.length, "bookshop cover sample files").toBeGreaterThan(0);
    expect(inventoryCovers.length, "inventory cover sample files").toBeGreaterThan(0);
    for (const attachment of [...bookCovers, ...inventoryCovers]) {
      const parsed = parseDataUrl(attachment.dataUrl);
      expect(parsed?.mimeType, attachment.filename).toBe("image/svg+xml");
      expect(parsed?.bytes.byteLength ?? 0, attachment.filename).toBeGreaterThan(100);
    }

    const orderCalendar = bookshop?.views?.find((view) => view.key === "order_calendar");
    const loanCalendar = inventory?.views?.find((view) => view.key === "open_loans");
    const transactionCalendar = finance?.views?.find((view) => view.key === "transaction_calendar");
    expect(((orderCalendar?.ui as { displayConfig?: { mode?: unknown } } | undefined)?.displayConfig)?.mode).toBe("calendar");
    expect(((loanCalendar?.ui as { displayConfig?: { mode?: unknown } } | undefined)?.displayConfig)?.mode).toBe("calendar");
    expect(((transactionCalendar?.ui as { displayConfig?: { mode?: unknown } } | undefined)?.displayConfig)?.mode).toBe("calendar");
    expect(((orderCalendar?.ui as { displayConfig?: { calendar?: { dateFieldId?: unknown } } } | undefined)?.displayConfig)?.calendar?.dateFieldId).toEqual(
      field("orders.ordered_at"),
    );
    expect(((loanCalendar?.ui as { displayConfig?: { calendar?: { dateFieldId?: unknown } } } | undefined)?.displayConfig)?.calendar?.dateFieldId).toEqual(
      field("loans.due_date"),
    );
    expect(((transactionCalendar?.ui as { displayConfig?: { calendar?: { dateFieldId?: unknown } } } | undefined)?.displayConfig)?.calendar?.dateFieldId).toEqual(
      field("transactions.date"),
    );
  });

  test("calendar templates include current-month sample records", () => {
    const expectations = [
      { templateId: "bookshop", table: "orders", field: "ordered_at" },
      { templateId: "finance", table: "transactions", field: "date" },
      { templateId: "inventory", table: "loans", field: "due_date" },
    ];

    for (const expectation of expectations) {
      const template = templates.find((item) => item.id === expectation.templateId);
      const records = (template?.records ?? []).filter((record) => record.table === expectation.table);
      const currentMonthDates = records.filter((record) => isCurrentMonthDate(record.values[expectation.field]));
      expect(
        currentMonthDates.length,
        `${expectation.templateId}.${expectation.table}.${expectation.field} current-month samples`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  test("form input entries include help text", () => {
    for (const template of templates) {
      for (const form of template.forms ?? []) {
        const fields = (form.config as { fields?: unknown }).fields;
        expect(Array.isArray(fields), `${template.id}.${form.key} fields`).toBe(true);

        for (const entry of fields as Array<Record<string, unknown>>) {
          if (entry.kind !== "user_input") continue;
          expect(
            typeof entry.helpText === "string" && entry.helpText.trim().length > 0,
            `${template.id}.${form.key}.${String(entry.fieldId)} helpText`,
          ).toBe(true);

          const inlineFields = (entry.inlineCreate as { fields?: unknown } | undefined)?.fields;
          if (!Array.isArray(inlineFields)) continue;
          for (const inlineEntry of inlineFields as Array<Record<string, unknown>>) {
            expect(
              typeof inlineEntry.helpText === "string" && inlineEntry.helpText.trim().length > 0,
              `${template.id}.${form.key}.${String(entry.fieldId)} inline ${String(inlineEntry.fieldId)} helpText`,
            ).toBe(true);
          }
        }
      }
    }
  });

  test("all internal references resolve", () => {
    for (const template of templates) {
      const index = indexTemplate(template);
      assertUnique(
        template.tables.map((table) => table.key),
        `${template.id} table keys`,
      );

      for (const table of template.tables) {
        assertUnique(
          table.fields.map((field) => field.key),
          `${template.id}.${table.key} field keys`,
        );
      }

      for (const ref of refsIn(template)) {
        const target =
          ref.$ref === "table"
            ? index.tables
            : ref.$ref === "field"
              ? index.fields
              : ref.$ref === "record"
                ? index.records
                : ref.$ref === "view"
                  ? index.views
                  : ref.$ref === "form"
                    ? index.forms
                    : index.dashboards;
        expect(target.has(ref.key), `${template.id} missing ${ref.$ref}:${ref.key}`).toBe(true);
      }

      if (template.defaultDashboard) {
        expect(index.dashboards.has(template.defaultDashboard), `${template.id} defaultDashboard`).toBe(true);
      }
    }
  });

  test("each template has meaningful dashboard charts", () => {
    for (const template of templates) {
      const viewsByKey = new Map((template.views ?? []).map((view) => [view.key, view]));
      const charts = dashboardCells(template).filter((cell) => cell.kind === "chart");
      expect(charts.length, `${template.id} dashboard charts`).toBeGreaterThan(0);

      for (const chart of charts) {
        const viewId = chart.viewId;
        expect(isRef(viewId) && viewId.$ref === "view", `${template.id}.${String(chart.id)} view ref`).toBe(true);
        if (!isRef(viewId)) continue;

        const view = viewsByKey.get(viewId.key);
        expect(view, `${template.id}.${String(chart.id)} chart view exists`).toBeDefined();
        const source = String(resolveTemplateGqlValue(view?.source ?? "", templateNamesForGql(template)));
        expect(source, `${template.id}.${viewId.key} chart groupBy`).toContain("group by");
        expect(source, `${template.id}.${viewId.key} chart aggregations`).toContain("aggregate");
        if (chart.format === "currency") {
          expect(source, `${template.id}.${viewId.key} currency chart value field`).toMatch(
            /aggregate[^\n]*(?:sum|avg|median|min|max|earliest|latest)\(/,
          );
        }
      }
    }
  });

  test("template views provide parseable GQL sources", () => {
    for (const template of templates) {
      const names = templateNamesForGql(template);
      for (const view of template.views ?? []) {
        const source = resolveTemplateGqlValue(view.source ?? "", names);
        expect(typeof source).toBe("string");
        expect(String(source), `${template.id}.${view.key} should use readable refs`).not.toMatch(
          /\{[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\}/i,
        );
        const parsed = parseGridsQueryDsl(String(source));
        expect(parsed.ok, `${template.id}.${view.key} parses as GQL`).toBe(true);
      }
    }
  });

  test("bookshop fields use polished labels and descriptions", () => {
    const bookshop = templates.find((template) => template.id === "bookshop");
    expect(bookshop, "bookshop template").toBeDefined();
    if (!bookshop) return;

    for (const table of bookshop.tables) {
      for (const field of table.fields) {
        expect(
          typeof field.description === "string" && field.description.trim().length > 0,
          `bookshop.${table.key}.${field.key} description`,
        ).toBe(true);
        expect(field.name.includes("_"), `bookshop.${table.key}.${field.key} label must not expose snake_case`).toBe(false);
        expect(field.name[0], `bookshop.${table.key}.${field.key} label should be human-readable`).toBe(field.name[0]?.toUpperCase());
      }
    }
  });
});
