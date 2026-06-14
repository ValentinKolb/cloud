import { beforeEach, describe, expect, mock, test } from "bun:test";

const viewerId = "44444444-4444-4444-8444-444444444444";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  shortId: "BASE1",
  name: "GQL Base",
  description: null,
  defaultDashboardId: null,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const table = {
  id: "22222222-2222-4222-8222-222222222222",
  shortId: "TBL01",
  baseId: base.id,
  name: "Orders",
  description: null,
  icon: null,
  columns: [],
  displayConfig: { mode: "table" as const },
  position: 0,
  disableDirectInsert: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const savedQuery = {
  id: "33333333-3333-4333-8333-333333333333",
  shortId: "GQL01",
  baseId: base.id,
  tableId: table.id,
  name: "Joined revenue",
  icon: null,
  source: `from table {${table.id}}\nselect`,
  ownerUserId: viewerId,
  position: 0,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const otherPrivateQuery = {
  ...savedQuery,
  id: "55555555-5555-4555-8555-555555555555",
  shortId: "GQL02",
  name: "Private query",
  ownerUserId: "66666666-6666-4666-8666-666666666666",
};

const sharedQuery = {
  ...savedQuery,
  id: "77777777-7777-4777-8777-777777777777",
  shortId: "GQL03",
  name: "Shared query",
  ownerUserId: null,
};

type TestGqlQuery = typeof savedQuery | typeof otherPrivateQuery | typeof sharedQuery;

let visibleGqlQueries: TestGqlQuery[] = [savedQuery];
let lookupGqlQuery: TestGqlQuery | null = savedQuery;
let baseLevel: "none" | "read" | "write" | "admin" = "read";

mock.module("../../../service", () => ({
  gridsService: {
    base: {
      getByIdOrShortId: async () => base,
      catalog: async () => ({
        dashboards: [],
        tables: [table],
        tableLevels: { [table.id]: "read" },
        fieldsByTable: { [table.id]: [] },
        viewsByTable: { [table.id]: [] },
        formsByTable: { [table.id]: [] },
        formLevels: {},
        formTables: [],
        sidebarForms: [],
      }),
    },
    permission: {
      loadGrants: async () => [],
      resolve: () => baseLevel,
      hasAtLeast: (actual: "none" | "read" | "write" | "admin", expected: "none" | "read" | "write" | "admin") => {
        const rank = { none: 0, read: 1, write: 2, admin: 3 };
        return rank[actual] >= rank[expected];
      },
    },
    dashboard: {
      getByIdOrShortId: async () => null,
      get: async () => null,
    },
    table: {
      getByIdOrShortId: async () => null,
    },
    gqlQuery: {
      listForBase: async () => visibleGqlQueries,
      getByIdOrShortId: async (_baseId: string, idOrSlug: string) =>
        lookupGqlQuery && (lookupGqlQuery.id === idOrSlug || lookupGqlQuery.shortId === idOrSlug) ? lookupGqlQuery : null,
    },
    access: {
      listForDashboard: async () => [],
      listForTable: async () => [],
      listForForm: async () => [],
      listForView: async () => [],
    },
  },
}));

const { loadGridsWorkspaceState } = await import("./workspace-state");

const user = {
  id: viewerId,
  roles: [],
  memberofGroupIds: [],
};

describe("loadGridsWorkspaceState — saved GQL queries", () => {
  beforeEach(() => {
    visibleGqlQueries = [savedQuery];
    lookupGqlQuery = savedQuery;
    baseLevel = "read";
  });

  test("loads a saved GQL query as the active query workspace route", async () => {
    const state = await loadGridsWorkspaceState({
      user,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/query/${savedQuery.shortId}`,
      activeGqlQuerySlug: savedQuery.shortId,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.catalog.gqlQueries).toEqual([savedQuery]);
    expect(state.route.kind).toBe("query");
    if (state.route.kind !== "query") return;
    expect(state.route.savedQuery).toEqual(savedQuery);
    expect(state.route.canEditSavedQuery).toBe(true);
    expect(state.route.initialQuery).toBe(savedQuery.source);
    expect(state.route.queryPath).toBe(`/app/grids/${base.shortId}/query/${savedQuery.shortId}`);
    expect(state.title.at(-1)?.title).toBe(savedQuery.name);
  });

  test("loads shared saved GQL queries as read-only for non-admin readers", async () => {
    visibleGqlQueries = [sharedQuery];
    lookupGqlQuery = sharedQuery;

    const state = await loadGridsWorkspaceState({
      user,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/query/${sharedQuery.shortId}`,
      activeGqlQuerySlug: sharedQuery.shortId,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.route.kind).toBe("query");
    if (state.route.kind !== "query") return;
    expect(state.route.savedQuery).toEqual(sharedQuery);
    expect(state.route.canEditSavedQuery).toBe(false);
  });

  test("denies direct links to private saved GQL queries owned by another user", async () => {
    visibleGqlQueries = [];
    lookupGqlQuery = otherPrivateQuery;

    const state = await loadGridsWorkspaceState({
      user,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/query/${otherPrivateQuery.shortId}`,
      activeGqlQuerySlug: otherPrivateQuery.shortId,
    });

    expect(state).toEqual({
      kind: "accessDenied",
      title: "Access denied",
      message: "No access to this query",
    });
  });
});
