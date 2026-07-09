import { expect } from "bun:test";
import type { Field } from "../service/types";
import { parseGridsQueryDsl } from "./parser";
import type { DslResolverContext } from "./resolver";

export const field = (overrides: Partial<Field> & Pick<Field, "id" | "shortId" | "name" | "type">): Field => ({
  id: overrides.id,
  shortId: overrides.shortId,
  tableId: overrides.tableId ?? "table_orders",
  name: overrides.name,
  description: null,
  icon: null,
  type: overrides.type,
  config: overrides.config ?? {},
  position: overrides.position ?? 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

export const orders = { kind: "table" as const, id: "11111111-1111-4111-8111-111111111111", shortId: "Orders", name: "Orders" };
export const customers = { kind: "table" as const, id: "22222222-2222-4222-8222-222222222222", shortId: "Custs", name: "Customers" };
export const regions = { kind: "table" as const, id: "44444444-4444-4444-8444-444444444444", shortId: "Regs", name: "Regions" };
export const cities = { kind: "table" as const, id: "55555555-5555-4555-8555-555555555555", shortId: "Cities", name: "Cities" };
export const countries = { kind: "table" as const, id: "66666666-6666-4666-8666-666666666666", shortId: "Cntrs", name: "Countries" };

export const customerFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const amountFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const costFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
export const statusFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
export const orderedAtFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
export const paidFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
export const customerLinkFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
export const attachmentFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8";
export const createdAtFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
export const createdByFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10";
export const customerNameFieldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const customerRegionFieldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const customerScoreFieldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
export const regionNameFieldId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
export const regionCityFieldId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
export const cityCountryFieldId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
export const countryNameFieldId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

export const fields: Field[] = [
  field({ id: customerFieldId, shortId: "customer", name: "Customer", type: "text", position: 1 }),
  field({ id: amountFieldId, shortId: "amount", name: "Amount", type: "number", position: 2 }),
  field({ id: costFieldId, shortId: "cost", name: "Cost", type: "number", position: 3 }),
  field({ id: statusFieldId, shortId: "status", name: "Status", type: "select", position: 4 }),
  field({ id: orderedAtFieldId, shortId: "ordered_at", name: "Ordered at", type: "date", position: 5 }),
  field({ id: paidFieldId, shortId: "paid", name: "Paid", type: "boolean", position: 6 }),
  field({
    id: customerLinkFieldId,
    shortId: "customer_link",
    name: "Customer link",
    type: "relation",
    position: 7,
    config: { targetTableId: customers.id },
  }),
];

export const createdAtField = field({ id: createdAtFieldId, shortId: "created_at", name: "Created at", type: "created_at", position: 8 });
export const createdByField = field({ id: createdByFieldId, shortId: "created_by", name: "Created by", type: "created_by", position: 9 });

export const customerFields: Field[] = [
  field({ id: customerNameFieldId, tableId: customers.id, shortId: "name", name: "Name", type: "text", position: 1 }),
  field({
    id: customerRegionFieldId,
    tableId: customers.id,
    shortId: "region",
    name: "Region",
    type: "relation",
    position: 2,
    config: { targetTableId: regions.id },
  }),
  field({ id: customerScoreFieldId, tableId: customers.id, shortId: "score", name: "Score", type: "number", position: 3 }),
];

export const regionFields: Field[] = [
  field({ id: regionNameFieldId, tableId: regions.id, shortId: "name", name: "Name", type: "text", position: 1 }),
  field({
    id: regionCityFieldId,
    tableId: regions.id,
    shortId: "city",
    name: "City",
    type: "relation",
    position: 2,
    config: { targetTableId: cities.id },
  }),
];

export const cityFields: Field[] = [
  field({
    id: cityCountryFieldId,
    tableId: cities.id,
    shortId: "country",
    name: "Country",
    type: "relation",
    position: 1,
    config: { targetTableId: countries.id },
  }),
];

export const countryFields: Field[] = [
  field({ id: countryNameFieldId, tableId: countries.id, shortId: "name", name: "Name", type: "text", position: 1 }),
];

export const ctx = (overrides: Partial<DslResolverContext> = {}): DslResolverContext => ({
  currentTable: orders,
  tables: [orders, customers, regions, cities, countries],
  views: [],
  fieldsByTableId: {
    [orders.id]: fields,
    [customers.id]: customerFields,
    [regions.id]: regionFields,
    [cities.id]: cityFields,
    [countries.id]: countryFields,
  },
  ...overrides,
});

export const parseOk = (source: string) => {
  const parsed = parseGridsQueryDsl(source);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join("; "));
  return parsed.ast;
};

export const normalizedSqlParts = (query: unknown): { text: string; values: unknown[] } => {
  const target = query as Record<symbol, unknown>;
  const symbols = Object.getOwnPropertySymbols(query as object);
  const symbol = (name: string) => symbols.find((item) => item.description === name);
  const strings = symbol("strings");
  const values = symbol("values");
  const adapter = symbol("adapter");
  const normalizeQuery = (adapter ? target[adapter] : null) as {
    normalizeQuery: (strings: unknown, values: unknown) => [string, unknown[]];
  } | null;
  if (!strings || !values || !normalizeQuery) throw new Error("Bun SQL query internals changed");
  const [text, params] = normalizeQuery.normalizeQuery(target[strings], target[values]);
  return { text, values: params };
};
export const normalizedSql = (query: unknown): string => normalizedSqlParts(query).text;
