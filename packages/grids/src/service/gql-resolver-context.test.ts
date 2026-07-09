import { describe, expect, mock, test } from "bun:test";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { resolveDslQueryToQueryPlan } from "../query-dsl/resolver";

const baseId = "11111111-1111-4111-8111-111111111111";
const ordersTableId = "22222222-2222-4222-8222-222222222222";
const hiddenTableId = "33333333-3333-4333-8333-333333333333";
const hiddenFieldId = "44444444-4444-4444-8444-444444444444";

const table = (id: string, shortId: string, name: string) => ({
  id,
  shortId,
  baseId,
  name,
  description: null,
  icon: null,
  columns: [],
  displayConfig: { mode: "table" as const },
  position: 0,
  disableDirectInsert: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const field = (tableId: string, id: string, shortId: string, name: string) => ({
  id,
  shortId,
  tableId,
  name,
  description: null,
  icon: null,
  type: "text",
  config: {},
  position: 0,
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

mock.module("./tables", () => ({
  listByBase: async (requestedBaseId: string) =>
    requestedBaseId === baseId ? [table(ordersTableId, "Orders", "Orders"), table(hiddenTableId, "Hidden", "Hidden")] : [],
}));

mock.module("./fields", () => ({
  listByTable: async (tableId: string) => (tableId === hiddenTableId ? [field(hiddenTableId, hiddenFieldId, "Secret", "Secret")] : []),
}));

const { buildTrustedGqlResolverContext } = await import("./gql-resolver-context");

describe("buildTrustedGqlResolverContext", () => {
  test("exposes all base tables for service-level document and dashboard renderers", async () => {
    const parsed = parseGridsQueryDsl("from table Hidden\nselect Secret");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const ctx = await buildTrustedGqlResolverContext({
      baseId,
      ast: parsed.ast,
      purpose: "document-template-render",
    });
    const resolved = resolveDslQueryToQueryPlan(parsed.ast, ctx);

    expect(ctx.tables.map((source) => source.name)).toEqual(["Orders", "Hidden"]);
    expect(ctx.fieldsByTableId[hiddenTableId]?.map((item) => item.name)).toEqual(["Secret"]);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.plan.tableId).toBe(hiddenTableId);
  });
});
