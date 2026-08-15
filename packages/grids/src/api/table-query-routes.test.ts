import { describe, expect, test } from "bun:test";
import { err, fail, ok } from "@k2b/stdlib";
import { BoundedQueryTimeoutError } from "../service/bounded-query";
import { createTableQueryRoutes } from "./table-query-routes";

const baseId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const viewId = "33333333-3333-4333-8333-333333333333";
const tablePublicId = "T4BL01";
const viewPublicId = "V1EW01";
const userId = "44444444-4444-4444-8444-444444444444";

const table = { id: tableId, baseId, kind: "stored" as const };
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
    onCompile?: (options: Record<string, unknown>) => void;
    onList?: (options: Record<string, unknown>) => void;
    listError?: Error;
    fields?: Array<{ id: string; shortId: string; type: string; config: Record<string, unknown> }>;
  } = {},
): RouteDeps => {
  const rank = { none: 0, read: 1, write: 2, admin: 3 };
  const service = {
    table: { getByShortId: async () => (overrides.table === undefined ? table : overrides.table) },
    view: { getByShortIdForTable: async () => (overrides.view === undefined ? view : overrides.view) },
    permission: {
      hasAtLeast: (actual: keyof typeof rank, expected: keyof typeof rank) => rank[actual] >= rank[expected],
    },
    field: { listByTable: async () => overrides.fields ?? [] },
    record: {
      list: async (options: Record<string, unknown>) => {
        overrides.onList?.(options);
        if (overrides.listError) throw overrides.listError;
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
    validateQuery: () => ok(undefined),
    dateConfig: async () => ({}) as never,
    gate: async () =>
      overrides.tableReadable ? ok("read" as const) : fail(err.forbidden("You do not have permission to access this resource.")),
    viewer: () => ({ userId, userGroups: [], serviceAccountId: null }),
    verifyFederatedRevision: async () => ok(),
  } as unknown as RouteDeps;
};

const requestQuery = (deps: RouteDeps, body: Record<string, unknown>) =>
  createTableQueryRoutes(deps).request(`/${tablePublicId}/query`, {
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

  test("denies saved views when their owning Base is unreadable", async () => {
    const response = await requestQuery(makeDeps(), { query: {}, viewId: viewPublicId });

    expect(response.status).toBe(403);
  });

  test("runs every saved GQL view after the owning Base read gate", async () => {
    let compileOptions: Record<string, unknown> | undefined;
    let listCalls = 0;
    const response = await requestQuery(
      makeDeps({
        tableReadable: true,
        onCompile: (options) => {
          compileOptions = options;
        },
        onList: () => {
          listCalls += 1;
        },
      }),
      { query: {}, viewId: viewPublicId },
    );

    expect(response.status).toBe(200);
    expect(compileOptions).toMatchObject({ baseId, tableId, source: view.source });
    expect(listCalls).toBe(1);
    expect(await response.json()).toEqual({ items: [], nextCursor: null, filePreviews: {} });
  });

  test("returns a retryable response when the database query exceeds its budget", async () => {
    const response = await requestQuery(makeDeps({ tableReadable: true, listError: new BoundedQueryTimeoutError(5_000) }), { query: {} });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({ message: "Query took too long. Narrow the query and retry." });
  });

  test("resolves structured public field ids before calling the record service", async () => {
    let options: Record<string, unknown> | undefined;
    const fieldId = "77777777-7777-4777-8777-777777777777";
    const response = await requestQuery(
      makeDeps({
        tableReadable: true,
        fields: [{ id: fieldId, shortId: "F1ELD1", type: "text", config: {} }],
        onList: (value) => {
          options = value;
        },
      }),
      { query: { filter: { fieldId: "F1ELD1", op: "equals", value: "ready" } } },
    );

    expect(response.status).toBe(200);
    expect(options?.filter).toEqual({ fieldId, op: "equals", value: "ready" });
  });

  test("rejects UUID and five-character structured public ids", async () => {
    for (const fieldId of ["77777777-7777-4777-8777-777777777777", "F1ELD"]) {
      const response = await requestQuery(makeDeps({ tableReadable: true }), {
        query: { filter: { fieldId, op: "equals", value: "ready" } },
      });
      expect(response.status).toBe(400);
    }
  });
});
