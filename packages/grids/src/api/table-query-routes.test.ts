import { describe, expect, test } from "bun:test";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { createTableQueryRoutes } from "./table-query-routes";

const baseId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const viewId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

const table = { id: tableId, baseId };
const view = {
  id: viewId,
  tableId,
  ownerUserId: "55555555-5555-4555-8555-555555555555",
  source: `from table {${tableId}} limit 10`,
  ui: {},
};

type RouteDeps = NonNullable<Parameters<typeof createTableQueryRoutes>[0]>;

const makeDeps = (
  overrides: {
    table?: typeof table | null;
    view?: typeof view | null;
    tableReadable?: boolean;
    viewLevel?: "none" | "read";
    explicitViewGrant?: boolean;
    onCompile?: (options: Record<string, unknown>) => void;
    onList?: () => void;
  } = {},
): RouteDeps => {
  const rank = { none: 0, read: 1, write: 2, admin: 3 };
  const service = {
    table: { get: async () => (overrides.table === undefined ? table : overrides.table) },
    view: { get: async () => (overrides.view === undefined ? view : overrides.view) },
    permission: {
      hasAtLeast: (actual: keyof typeof rank, expected: keyof typeof rank) => rank[actual] >= rank[expected],
    },
    field: { listByTable: async () => [] },
    record: {
      list: async () => {
        overrides.onList?.();
        return { ok: true, data: { items: [], nextCursor: null, filePreviews: {} } };
      },
      aggregate: async () => ({ ok: true, data: {} }),
      group: async () => ({ ok: true, data: { buckets: [], nextCursor: null, explode: false } }),
    },
    relations: { buildLabelCacheForGroupedKeys: async () => ({}) },
  };
  const compileGql: RouteDeps["compileGql"] = async (_context, options) => {
    overrides.onCompile?.(options as unknown as Record<string, unknown>);
    return { ok: true, query: { limit: 10 } } as Awaited<ReturnType<RouteDeps["compileGql"]>>;
  };

  return {
    service,
    compileGql,
    validateQuery: async () => ok(undefined),
    dateConfig: async () => ({}) as never,
    gate: async () =>
      overrides.tableReadable ? ok("read" as const) : fail(err.forbidden("You do not have permission to access this resource.")),
    resolve: async () => ({ level: overrides.viewLevel ?? "read", grants: [] }),
    viewer: () => ({ userId, userGroups: [], serviceAccountId: null }),
    hasExplicitGrant: () => overrides.explicitViewGrant ?? false,
  } as unknown as RouteDeps;
};

const requestQuery = (deps: RouteDeps, body: Record<string, unknown>) =>
  createTableQueryRoutes(deps).request(`/${tableId}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("table query routes", () => {
  test("returns 404 for an unknown table", async () => {
    const response = await requestQuery(makeDeps({ table: null }), { query: {} });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Table not found" });
  });

  test("denies direct queries without table read access", async () => {
    const response = await requestQuery(makeDeps(), { query: {} });

    expect(response.status).toBe(403);
  });

  test("hides personal views without an explicit view grant", async () => {
    const response = await requestQuery(makeDeps(), { query: {}, viewId });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "View not found" });
  });

  test("runs the saved GQL source for explicitly readable views without table read access", async () => {
    let compileOptions: Record<string, unknown> | undefined;
    let listCalls = 0;
    const response = await requestQuery(
      makeDeps({
        explicitViewGrant: true,
        onCompile: (options) => {
          compileOptions = options;
        },
        onList: () => {
          listCalls += 1;
        },
      }),
      { query: {}, viewId },
    );

    expect(response.status).toBe(200);
    expect(compileOptions).toMatchObject({ source: view.source, trustedAllSources: true });
    expect(listCalls).toBe(1);
    expect(await response.json()).toEqual({ items: [], nextCursor: null, filePreviews: {} });
  });
});
