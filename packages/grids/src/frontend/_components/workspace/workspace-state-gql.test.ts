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
        return { ok: true, data: { items: [], aggregates: {}, nextCursor: null, filePreviews: {} } };
      },
      group: async () => ({ ok: true, data: { buckets: [], explode: false, nextCursor: null } }),
      get: async () => null,
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
});
