import { describe, expect, mock, test } from "bun:test";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  shortId: "BASE1",
  name: "Forms Base",
  description: null,
  defaultDashboardId: null,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const formTable = {
  id: "22222222-2222-4222-8222-222222222222",
  shortId: "TBL01",
  baseId: base.id,
  name: "Hidden table",
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

const form = {
  id: "33333333-3333-4333-8333-333333333333",
  shortId: "FORM1",
  tableId: formTable.id,
  name: "Intake",
  config: { fields: [] },
  publicToken: null,
  isActive: true,
  ownerUserId: null,
  position: 0,
  isDefault: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

mock.module("../../../service", () => ({
  gridsService: {
    base: {
      getByIdOrShortId: async () => base,
      catalog: async () => ({
        dashboards: [],
        tables: [],
        tableLevels: {},
        fieldsByTable: { [formTable.id]: [] },
        viewsByTable: {},
        formsByTable: { [formTable.id]: [form] },
        formLevels: { [form.id]: "write" },
        formTables: [formTable],
        sidebarForms: [{ form, tableId: formTable.id }],
      }),
    },
    permission: {
      loadGrants: async () => [],
      resolve: () => "none",
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
    access: {
      listForDashboard: async () => [],
      listForTable: async () => [],
      listForForm: async () => [],
      listForView: async () => [],
    },
  },
}));

const { loadGridsWorkspaceState } = await import("./workspace-state");

describe("loadGridsWorkspaceState — form-only access", () => {
  test("allows users with form-write but no base/table read into an empty workspace with sidebar forms", async () => {
    const state = await loadGridsWorkspaceState({
      user: {
        id: "44444444-4444-4444-8444-444444444444",
        roles: [],
        memberofGroupIds: [],
      },
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}`,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.route.kind).toBe("empty");
    expect(state.catalog.tables).toEqual([]);
    expect(state.catalog.viewsByTable).toEqual({});
    expect(state.catalog.sidebarForms).toEqual([{ form, table: formTable }]);
    expect(state.catalog.tableShortIds).toEqual({ [formTable.id]: formTable.shortId });
    expect(state.canUseEditMode).toBe(false);
  });
});
