import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { gridsService } from "../../../service";
import { loadGridsWorkspaceState } from "./workspace-state";

const loadWorkspaceState = (params: Parameters<typeof loadGridsWorkspaceState>[0]) =>
  loadGridsWorkspaceState(params, {
    latestMetadataEventCursor: async () => null,
    latestRecordEventCursor: async () => null,
  });

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
  kind: "stored" as const,
  name: "Hidden table",
  description: null,
  icon: null,
  columns: [],
  displayConfig: { mode: "table" as const },
  auditPolicy: {},
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

describe("loadGridsWorkspaceState — form-only access", () => {
  beforeEach(() => {
    spyOn(gridsService.base, "getByIdOrShortId").mockImplementation(async () => base as never);
    spyOn(gridsService.base, "catalog").mockImplementation(
      async () =>
        ({
          dashboards: [],
          tables: [],
          tableLevels: {},
          fieldsByTable: { [formTable.id]: [] },
          viewsByTable: {},
          formsByTable: { [formTable.id]: [form] },
          formLevels: { [form.id]: "write" },
          formTables: [formTable],
          sidebarForms: [{ form, tableId: formTable.id }],
        }) as never,
    );
    spyOn(gridsService.permission, "loadGrants").mockImplementation(async () => []);
    spyOn(gridsService.permission, "resolve").mockImplementation(() => "none");
    spyOn(gridsService.dashboard, "getByIdOrShortId").mockImplementation(async () => null);
    spyOn(gridsService.dashboard, "get").mockImplementation(async () => null);
    spyOn(gridsService.table, "getByIdOrShortId").mockImplementation(async () => null);
    spyOn(gridsService.workflow, "listForBase").mockImplementation(async () => []);
    spyOn(gridsService.access, "listForDashboard").mockImplementation(async () => []);
    spyOn(gridsService.access, "listForTable").mockImplementation(async () => []);
    spyOn(gridsService.access, "listForForm").mockImplementation(async () => []);
    spyOn(gridsService.access, "listForView").mockImplementation(async () => []);
  });

  afterEach(() => mock.restore());

  test("allows users with form-write but no base/table read into an empty workspace with sidebar forms", async () => {
    const state = await loadWorkspaceState({
      user: {
        id: "44444444-4444-4444-8444-444444444444",
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
    expect(state.canUseQueryWorkspace).toBe(false);
  });

  test("keeps metadata and record cursors on their matching SSR streams", async () => {
    const loadedStreams: string[] = [];
    const state = await loadGridsWorkspaceState(
      {
        user: {
          id: "44444444-4444-4444-8444-444444444444",
          memberofGroupIds: [],
        },
        baseShortId: base.shortId,
        href: `/app/grids/${base.shortId}`,
      },
      {
        latestMetadataEventCursor: async (baseId) => {
          loadedStreams.push(`metadata:${baseId}`);
          return "metadata-cursor";
        },
        latestRecordEventCursor: async (baseId) => {
          loadedStreams.push(`records:${baseId}`);
          return "record-cursor";
        },
      },
    );

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.metadataEventCursor).toBe("metadata-cursor");
    expect(state.recordEventCursor).toBe("record-cursor");
    expect(loadedStreams.sort()).toEqual([`metadata:${base.id}`, `records:${base.id}`]);
  });

  test("keeps the healthy SSR cursor when the other stream is unavailable", async () => {
    const state = await loadGridsWorkspaceState(
      {
        user: {
          id: "44444444-4444-4444-8444-444444444444",
          memberofGroupIds: [],
        },
        baseShortId: base.shortId,
        href: `/app/grids/${base.shortId}`,
      },
      {
        latestMetadataEventCursor: async () => {
          throw new Error("metadata stream unavailable");
        },
        latestRecordEventCursor: async () => "record-cursor",
      },
    );

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.metadataEventCursor).toBeNull();
    expect(state.recordEventCursor).toBe("record-cursor");
  });

  test("does not expose the query workspace to form-only users", async () => {
    const state = await loadWorkspaceState({
      user: {
        id: "44444444-4444-4444-8444-444444444444",
        memberofGroupIds: [],
      },
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/query`,
    });

    expect(state).toEqual({
      kind: "accessDenied",
      title: "Access denied",
      message: "No access to this base",
    });
  });
});
