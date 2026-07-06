import { beforeEach, describe, expect, mock, test } from "bun:test";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  shortId: "BASE1",
  name: "Documents Base",
  description: null,
  documentProfile: {},
  defaultDashboardId: null,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const documentTable = {
  id: "22222222-2222-4222-8222-222222222222",
  shortId: "TBL01",
  baseId: base.id,
  name: "Invoices",
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

const template = {
  id: "33333333-3333-4333-8333-333333333333",
  shortId: "TPL01",
  tableId: documentTable.id,
  name: "Invoice",
  description: "Customer invoice.",
  source: `from table {${documentTable.id}}\nwhere record.id = '{{ record.id }}'\nlimit 1`,
  html: "<p>{{ record.id }}</p>",
  headerHtml: null,
  footerHtml: null,
  pageCss: null,
  enabled: true,
  position: 0,
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const templateSummary = {
  id: template.id,
  shortId: template.shortId,
  tableId: template.tableId,
  name: template.name,
  description: template.description,
  enabled: template.enabled,
  position: template.position,
  createdAt: template.createdAt,
  updatedAt: template.updatedAt,
};

let documentTemplateLevel: "read" | "write" = "read";

mock.module("../../../service", () => ({
  gridsService: {
    base: {
      getByIdOrShortId: async () => base,
      catalog: async () => ({
        dashboards: [],
        tables: [],
        tableLevels: {},
        fieldsByTable: {},
        viewsByTable: {},
        formsByTable: {},
        formLevels: {},
        formTables: [],
        sidebarForms: [],
        documentTemplatesByTable: { [documentTable.id]: [template] },
        documentTemplateLevels: { [template.id]: documentTemplateLevel },
        documentTemplateTables: [documentTable],
        sidebarDocumentTemplates: [{ template, tableId: documentTable.id }],
      }),
    },
    permission: {
      loadGrants: async () => [],
      resolve: (_grants: unknown, target: Record<string, unknown>) => ("documentTemplateId" in target ? documentTemplateLevel : "none"),
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
        documentTable.id === idOrSlug || documentTable.shortId === idOrSlug ? documentTable : null,
    },
    document: {
      getTemplateByIdOrShortId: async (_tableId: string, idOrSlug: string) =>
        template.id === idOrSlug || template.shortId === idOrSlug ? template : null,
      summarizeTemplate: () => templateSummary,
    },
    view: {
      getByIdOrShortId: async () => null,
    },
    access: {
      listForDashboard: async () => [],
      listForTable: async () => [],
      listForForm: async () => [],
      listForView: async () => [],
      listForDocumentTemplate: async () => [],
    },
  },
}));

const { loadGridsWorkspaceState } = await import("./workspace-state");

describe("loadGridsWorkspaceState — document-template-only access", () => {
  beforeEach(() => {
    documentTemplateLevel = "read";
  });

  test("opens a document template route without base or table read access", async () => {
    const state = await loadGridsWorkspaceState({
      user: {
        id: "44444444-4444-4444-8444-444444444444",
        memberofGroupIds: [],
      },
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/document/${documentTable.shortId}/${template.shortId}?record=55555555-5555-4555-8555-555555555555`,
      activeDocumentTableSlug: documentTable.shortId,
      activeDocumentTemplateSlug: template.shortId,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.route.kind).toBe("documentTemplate");
    if (state.route.kind !== "documentTemplate") return;
    expect(state.route.template.id).toBe(template.id);
    expect("source" in state.route.template).toBe(false);
    expect("html" in state.route.template).toBe(false);
    expect(state.route.editableTemplate).toBeNull();
    expect(state.route.canWriteTemplate).toBe(false);
    expect(state.route.table.id).toBe(documentTable.id);
    expect(state.route.initialRecordId).toBe("55555555-5555-4555-8555-555555555555");
    expect(state.route.initialDocumentViewMode).toBe("list");
    expect(state.catalog.tables).toEqual([]);
    expect(state.catalog.sidebarDocumentTemplates).toEqual([{ template: templateSummary, table: documentTable }]);
    expect("source" in state.catalog.sidebarDocumentTemplates[0]!.template).toBe(false);
    expect("html" in state.catalog.sidebarDocumentTemplates[0]!.template).toBe(false);
    expect(state.canUseQueryWorkspace).toBe(false);
  });

  test("marks document template routes writable only with document write access", async () => {
    documentTemplateLevel = "write";

    const state = await loadGridsWorkspaceState({
      user: {
        id: "44444444-4444-4444-8444-444444444444",
        memberofGroupIds: [],
      },
      baseShortId: base.shortId,
      href: `/app/grids/${base.shortId}/document/${documentTable.shortId}/${template.shortId}`,
      activeDocumentTableSlug: documentTable.shortId,
      activeDocumentTemplateSlug: template.shortId,
      initialDocumentViewMode: "folders",
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.route.kind).toBe("documentTemplate");
    if (state.route.kind !== "documentTemplate") return;
    expect(state.route.canWriteTemplate).toBe(true);
    expect(state.route.initialDocumentViewMode).toBe("folders");
  });
});
