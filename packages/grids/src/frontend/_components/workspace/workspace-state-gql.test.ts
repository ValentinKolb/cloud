import { beforeEach, describe, expect, mock, test } from "bun:test";

const viewerId = "44444444-4444-4444-8444-444444444444";
const selectedRecordId = "77777777-7777-4777-8777-777777777777";

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

const statusField = {
  id: "88888888-8888-4888-8888-888888888888",
  shortId: "STAT1",
  tableId: table.id,
  name: "Status",
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
};

const savedView = {
  id: "99999999-9999-4999-8999-999999999999",
  shortId: "VIEW1",
  tableId: table.id,
  name: "Open orders",
  description: null,
  icon: null,
  source: `from table {${table.id}}\nwhere {${statusField.id}} = 'Open'\nsort {${statusField.id}} asc`,
  ui: { displayConfig: { mode: "table" as const } },
  ownerUserId: null,
  position: 0,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let baseLevel: "none" | "read" | "write" | "admin" = "read";
let viewLevel: "none" | "read" | "write" | "admin" = "read";
let catalogTables: unknown[] = [table];
let catalogTableLevels: Record<string, "none" | "read" | "write" | "admin"> = { [table.id]: "read" };
let catalogFieldsByTable: Record<string, unknown[]> = { [table.id]: [statusField] };
let catalogViewsByTable: Record<string, unknown[]> = { [table.id]: [] };
let lookupTable: typeof table | null = null;
let lookupView: typeof savedView | null = null;
let lastRecordListParams: Record<string, unknown> | null = null;
let recordGetCalls = 0;
let recordListRecordForId: unknown | null = null;

mock.module("../../../service", () => ({
  gridsService: {
    base: {
      getByIdOrShortId: async () => base,
      catalog: async () => ({
        dashboards: [],
        tables: catalogTables,
        tableLevels: catalogTableLevels,
        fieldsByTable: catalogFieldsByTable,
        viewsByTable: catalogViewsByTable,
        formsByTable: { [table.id]: [] },
        formLevels: {},
        formTables: [],
        sidebarForms: [],
      }),
    },
    permission: {
      loadGrants: async () => [],
      resolve: (_grants: unknown, target: Record<string, unknown>) => ("viewId" in target ? viewLevel : baseLevel),
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
      getByIdOrShortId: async (_baseId: string, idOrSlug: string) =>
        lookupTable && (lookupTable.id === idOrSlug || lookupTable.shortId === idOrSlug) ? lookupTable : null,
    },
    view: {
      getByIdOrShortId: async (_tableId: string, idOrSlug: string) =>
        lookupView && (lookupView.id === idOrSlug || lookupView.shortId === idOrSlug) ? lookupView : null,
    },
    field: {
      listByTable: async () => [statusField],
    },
    access: {
      listForDashboard: async () => [],
      listForTable: async () => [],
      listForForm: async () => [],
      listForView: async () => [],
    },
    record: {
      list: async (params: Record<string, unknown>) => {
        lastRecordListParams = params;
        const ids = (params.recordMeta as { ids?: unknown[] } | null | undefined)?.ids;
        const items = ids?.includes(selectedRecordId) && recordListRecordForId ? [recordListRecordForId] : [];
        return { ok: true, data: { items, aggregates: {}, nextCursor: null, filePreviews: {} } };
      },
      group: async () => ({ ok: true, data: { buckets: [], explode: false, nextCursor: null } }),
      get: async () => {
        recordGetCalls += 1;
        return null;
      },
    },
    aggregate: {},
    relations: {
      buildLabelCache: async () => ({}),
      buildLabelCacheForGroupedKeys: async () => ({}),
    },
  },
}));

const { loadGridsWorkspaceState } = await import("./workspace-state");

const user = {
  id: viewerId,
  roles: [],
  memberofGroupIds: [],
};

describe("loadGridsWorkspaceState — GQL-backed views", () => {
  beforeEach(() => {
    baseLevel = "read";
    viewLevel = "read";
    catalogTables = [table];
    catalogTableLevels = { [table.id]: "read" };
    catalogFieldsByTable = { [table.id]: [statusField] };
    catalogViewsByTable = { [table.id]: [] };
    lookupTable = null;
    lookupView = null;
    lastRecordListParams = null;
    recordGetCalls = 0;
    recordListRecordForId = null;
  });

  test("loads records views from canonical GQL source instead of cached RecordQuery JSON", async () => {
    catalogViewsByTable = { [table.id]: [savedView] };
    lookupTable = table;
    lookupView = savedView;

    const state = await loadGridsWorkspaceState({
      user,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/table/${table.shortId}/view/${savedView.shortId}`,
      activeTableSlug: table.shortId,
      activeViewSlug: savedView.shortId,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.route.kind).toBe("records");
    if (state.route.kind !== "records") return;
    expect(state.route.initialState.query.filter).toEqual({ fieldId: statusField.id, op: "equals", value: "Open" });
    expect(state.route.initialState.query.sort).toEqual([{ fieldId: statusField.id, direction: "asc" }]);
    expect(lastRecordListParams?.filter).toEqual({ fieldId: statusField.id, op: "equals", value: "Open" });
  });

  test("routes aggregate-only saved views to the query-result runtime without listing records", async () => {
    const aggregateView = {
      ...savedView,
      id: "66666666-6666-4666-8666-666666666666",
      shortId: "COUNT",
      name: "Orders count",
      source: `from table {${table.id}}\naggregate count(*) as orders`,
    };
    catalogViewsByTable = { [table.id]: [aggregateView] };
    lookupTable = table;
    lookupView = aggregateView;

    const state = await loadGridsWorkspaceState({
      user,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/table/${table.shortId}/view/${aggregateView.shortId}?cursor=signed-cursor`,
      activeTableSlug: table.shortId,
      activeViewSlug: aggregateView.shortId,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok" || state.route.kind !== "queryResultView") return;
    expect(state.route.activeView.id).toBe(aggregateView.id);
    expect(state.route.initialCursor).toBe("signed-cursor");
    expect(state.route.initialResult).toBeNull();
    expect(lastRecordListParams).toBeNull();
  });

  test("hydrates grouped aggregate sort into the client records state", async () => {
    const groupedView = {
      ...savedView,
      source: `from table {${table.id}}\ngroup by {${statusField.id}}\naggregate count(*) as rows\nsort {${statusField.id}} asc, rows desc`,
    };
    catalogViewsByTable = { [table.id]: [groupedView] };
    lookupTable = table;
    lookupView = groupedView;

    const state = await loadGridsWorkspaceState({
      user,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/table/${table.shortId}/view/${groupedView.shortId}`,
      activeTableSlug: table.shortId,
      activeViewSlug: groupedView.shortId,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok" || state.route.kind !== "records") return;
    expect(state.route.initialState.query.groupSort).toEqual([{ fieldId: "*", agg: "count", direction: "desc" }]);
  });

  test("loads an explicitly readable view even when the parent table is hidden from the catalog", async () => {
    catalogTables = [];
    catalogTableLevels = {};
    catalogFieldsByTable = {};
    lookupTable = table;
    lookupView = savedView;
    viewLevel = "read";

    const state = await loadGridsWorkspaceState({
      user,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/table/${table.shortId}/view/${savedView.shortId}`,
      activeTableSlug: table.shortId,
      activeViewSlug: savedView.shortId,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.route.kind).toBe("records");
    if (state.route.kind !== "records") return;
    expect(state.catalog.tables).toEqual([]);
    expect(state.route.activeTable.id).toBe(table.id);
    expect(state.route.activeView?.id).toBe(savedView.id);
    expect(state.route.fields.map((field) => field.id)).toEqual([statusField.id]);
    expect(state.route.canWriteRecords).toBe(false);
  });

  test("loads an explicitly readable query-result view without parent table access", async () => {
    const aggregateView = {
      ...savedView,
      id: "66666666-6666-4666-8666-666666666666",
      shortId: "COUNT",
      name: "Orders count",
      source: `from table {${table.id}}\naggregate count(*) as orders`,
    };
    catalogTables = [];
    catalogTableLevels = {};
    catalogFieldsByTable = {};
    lookupTable = table;
    lookupView = aggregateView;
    viewLevel = "read";

    const state = await loadGridsWorkspaceState({
      user,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/table/${table.shortId}/view/${aggregateView.shortId}`,
      activeTableSlug: table.shortId,
      activeViewSlug: aggregateView.shortId,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok" || state.route.kind !== "queryResultView") return;
    expect(state.catalog.tables).toEqual([]);
    expect(state.route.activeView.id).toBe(aggregateView.id);
    expect(state.route.fields).toEqual([]);
    expect(state.route.canManageActiveTable).toBe(false);
    expect(lastRecordListParams).toBeNull();
  });

  test("defers hidden-source joins in an explicitly readable view to the trusted query runtime", async () => {
    const hiddenJoinView = {
      ...savedView,
      id: "55555555-5555-4555-8555-555555555555",
      shortId: "JOIN1",
      name: "Joined orders",
      source: `from table {${table.id}} as orders\njoin table {33333333-3333-4333-8333-333333333333} as hidden on orders.id = hidden.id`,
    };
    catalogTables = [];
    catalogTableLevels = {};
    catalogFieldsByTable = {};
    lookupTable = table;
    lookupView = hiddenJoinView;
    viewLevel = "read";

    const state = await loadGridsWorkspaceState({
      user,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/table/${table.shortId}/view/${hiddenJoinView.shortId}`,
      activeTableSlug: table.shortId,
      activeViewSlug: hiddenJoinView.shortId,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok" || state.route.kind !== "queryResultView") return;
    expect(state.route.activeView.id).toBe(hiddenJoinView.id);
    expect(state.route.fields).toEqual([]);
    expect(lastRecordListParams).toBeNull();
  });

  test("loads selected records through the readable view query when table read is denied", async () => {
    catalogTables = [];
    catalogTableLevels = {};
    catalogFieldsByTable = {};
    lookupTable = table;
    lookupView = savedView;
    viewLevel = "read";
    recordListRecordForId = {
      id: selectedRecordId,
      tableId: table.id,
      data: { [statusField.id]: "Open" },
      version: 1,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const state = await loadGridsWorkspaceState({
      user,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/table/${table.shortId}/view/${savedView.shortId}?record=${selectedRecordId}`,
      activeTableSlug: table.shortId,
      activeViewSlug: savedView.shortId,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.route.kind).toBe("records");
    if (state.route.kind !== "records") return;
    expect(recordGetCalls).toBe(0);
    expect(state.route.initialSelectedRecord?.id).toBe(selectedRecordId);
    expect(lastRecordListParams?.recordMeta).toEqual({ ids: [selectedRecordId] });
    expect(lastRecordListParams?.filter).toEqual({ fieldId: statusField.id, op: "equals", value: "Open" });
  });

  test("does not treat Cloud admin role as Grids base access", async () => {
    baseLevel = "none";
    const adminUser = { ...user, roles: ["admin", "user", "local", "local/user"] };

    const state = await loadGridsWorkspaceState({
      user: adminUser,
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}`,
    });

    expect(state.kind).toBe("accessDenied");
    if (state.kind !== "accessDenied") return;
    expect(state.message).toBe("No access to this base");
  });
});
