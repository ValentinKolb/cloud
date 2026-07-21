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
  kind: "stored" as const,
  name: "Invoices",
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

const documentRun = {
  id: "66666666-6666-4666-8666-666666666666",
  shortId: "RUN01",
  baseId: base.id,
  tableId: documentTable.id,
  recordId: "55555555-5555-4555-8555-555555555555",
  filename: "invoice.pdf",
  templateId: template.id,
  workflowRunId: null,
  snapshotId: "77777777-7777-4777-8777-777777777777",
  documentNumber: "INV-001",
  tags: [],
  generatedBy: null,
  generatedAt: "2026-01-01T00:00:00.000Z",
};

let documentTemplateLevel: "read" | "write" = "read";

describe("loadGridsWorkspaceState — document-template-only access", () => {
  beforeEach(() => {
    documentTemplateLevel = "read";
    spyOn(gridsService.base, "getByIdOrShortId").mockImplementation(async () => base as never);
    spyOn(gridsService.base, "catalog").mockImplementation(
      async () =>
        ({
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
        }) as never,
    );
    spyOn(gridsService.permission, "loadGrants").mockImplementation(async () => []);
    spyOn(gridsService.permission, "resolve").mockImplementation((_grants, target) =>
      "documentTemplateId" in target ? documentTemplateLevel : "none",
    );
    spyOn(gridsService.dashboard, "getByIdOrShortId").mockImplementation(async () => null);
    spyOn(gridsService.dashboard, "get").mockImplementation(async () => null);
    spyOn(gridsService.table, "getByIdOrShortId").mockImplementation(
      async (_baseId, idOrSlug) => (documentTable.id === idOrSlug || documentTable.shortId === idOrSlug ? documentTable : null) as never,
    );
    spyOn(gridsService.document, "getTemplateByIdOrShortId").mockImplementation(
      async (_tableId, idOrSlug) => (template.id === idOrSlug || template.shortId === idOrSlug ? template : null) as never,
    );
    spyOn(gridsService.document, "browseRunsForTemplate").mockImplementation(
      async () =>
        ({
          path: [],
          folders: [],
          items: [documentRun],
          total: 1,
          limit: 200,
          hasMore: false,
          nextCursor: null,
        }) as never,
    );
    spyOn(gridsService.document, "summarizeRun").mockImplementation((run) => run as never);
    spyOn(gridsService.document, "summarizeTemplate").mockImplementation(() => templateSummary as never);
    spyOn(gridsService.view, "getByIdOrShortId").mockImplementation(async () => null);
    spyOn(gridsService.workflow, "listForBase").mockImplementation(async () => []);
    spyOn(gridsService.access, "listForDashboard").mockImplementation(async () => []);
    spyOn(gridsService.access, "listForTable").mockImplementation(async () => []);
    spyOn(gridsService.access, "listForForm").mockImplementation(async () => []);
    spyOn(gridsService.access, "listForView").mockImplementation(async () => []);
    spyOn(gridsService.access, "listForDocumentTemplate").mockImplementation(async () => []);
  });

  afterEach(() => mock.restore());

  test("opens a document template route without base or table read access", async () => {
    const state = await loadWorkspaceState({
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
    expect(state.route.initialBrowserPage.items).toEqual([documentRun]);
    expect(state.route.initialBrowserPage.total).toBe(1);
    expect(state.catalog.tables).toEqual([]);
    expect(state.catalog.sidebarDocumentTemplates).toEqual([{ template: templateSummary, table: documentTable }]);
    expect("source" in state.catalog.sidebarDocumentTemplates[0]!.template).toBe(false);
    expect("html" in state.catalog.sidebarDocumentTemplates[0]!.template).toBe(false);
    expect(state.canUseQueryWorkspace).toBe(false);
  });

  test("marks document template routes writable only with document write access", async () => {
    documentTemplateLevel = "write";

    const state = await loadWorkspaceState({
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
