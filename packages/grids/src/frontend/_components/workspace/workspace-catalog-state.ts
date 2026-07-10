import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import type { DocumentTemplateSummary } from "../../../contracts";
import type { Form, Table } from "../../../service";
import { gridsService } from "../../../service";
import { workflowLevelForUser } from "./workspace-state-access";
import type { AuthUser, WorkspaceCatalog } from "./workspace-state-model";

const loadFormAccessEntriesByTable = async (
  tables: Table[],
  tableLevels: Record<string, "none" | "read" | "write" | "admin">,
  formsByTable: Record<string, Form[]>,
) => {
  const formAccessEntriesByTable: Record<string, Record<string, AccessEntry[]>> = {};
  await Promise.all(
    tables
      .filter((table) => gridsService.permission.hasAtLeast(tableLevels[table.id] ?? "none", "admin"))
      .map(async (table) => {
        const entries: Record<string, AccessEntry[]> = {};
        await Promise.all(
          (formsByTable[table.id] ?? [])
            .filter((form) => !form.isDefault)
            .map(async (form) => {
              entries[form.id] = await gridsService.access.listForForm(form.id);
            }),
        );
        formAccessEntriesByTable[table.id] = entries;
      }),
  );
  return formAccessEntriesByTable;
};

const loadDocumentTemplateAccessEntriesByTable = async (
  templatesByTable: Record<string, Array<Pick<DocumentTemplateSummary, "id">>>,
  templateLevels: Record<string, "none" | "read" | "write" | "admin">,
) => {
  const entriesByTable: Record<string, Record<string, AccessEntry[]>> = {};
  await Promise.all(
    Object.entries(templatesByTable).map(async ([tableId, templates]) => {
      const entries: Record<string, AccessEntry[]> = {};
      await Promise.all(
        templates
          .filter((template) => gridsService.permission.hasAtLeast(templateLevels[template.id] ?? "none", "admin"))
          .map(async (template) => {
            entries[template.id] = await gridsService.access.listForDocumentTemplate(template.id);
          }),
      );
      entriesByTable[tableId] = entries;
    }),
  );
  return entriesByTable;
};

export const loadCatalog = async (baseId: string, user: AuthUser): Promise<WorkspaceCatalog> => {
  const catalogRaw = await gridsService.base.catalog({
    baseId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  const tables = catalogRaw.tables;
  const formTables = catalogRaw.formTables ?? [];
  const documentTemplateTables = catalogRaw.documentTemplateTables ?? [];
  const tableById = Object.fromEntries([...tables, ...formTables, ...documentTemplateTables].map((table) => [table.id, table]));
  const sidebarForms: Array<{ form: Form; table: Table }> = [];
  for (const { form, tableId } of catalogRaw.sidebarForms) {
    const table = tableById[tableId];
    if (table) sidebarForms.push({ form, table });
  }
  sidebarForms.sort((left, right) => left.form.name.localeCompare(right.form.name, undefined, { sensitivity: "base" }));
  const documentTemplatesByTable = Object.fromEntries(
    Object.entries(catalogRaw.documentTemplatesByTable ?? {}).map(([tableId, templates]) => [
      tableId,
      templates.map(gridsService.document.summarizeTemplate),
    ]),
  );
  const sidebarDocumentTemplates: Array<{ template: DocumentTemplateSummary; table: Table }> = [];
  for (const { template, tableId } of catalogRaw.sidebarDocumentTemplates ?? []) {
    const table = tableById[tableId];
    if (table) sidebarDocumentTemplates.push({ template: gridsService.document.summarizeTemplate(template), table });
  }
  sidebarDocumentTemplates.sort((left, right) => left.template.name.localeCompare(right.template.name, undefined, { sensitivity: "base" }));

  const formAccessEntriesByTable = await loadFormAccessEntriesByTable(tables, catalogRaw.tableLevels, catalogRaw.formsByTable);
  const documentTemplateAccessEntriesByTable = await loadDocumentTemplateAccessEntriesByTable(
    documentTemplatesByTable,
    catalogRaw.documentTemplateLevels ?? {},
  );
  const allWorkflows = gridsService.workflow?.listForBase ? await gridsService.workflow.listForBase(baseId) : [];
  const workflowLevels = Object.fromEntries(
    await Promise.all(allWorkflows.map(async (workflow) => [workflow.id, await workflowLevelForUser(user, baseId, workflow.id)] as const)),
  );
  const workflows = allWorkflows
    .filter((workflow) => gridsService.permission.hasAtLeast(workflowLevels[workflow.id] ?? "none", "read"))
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  return {
    dashboards: catalogRaw.dashboards,
    workflows,
    workflowLevels,
    tables,
    tableLevels: catalogRaw.tableLevels,
    fieldsByTable: catalogRaw.fieldsByTable,
    viewsByTable: catalogRaw.viewsByTable,
    formsByTable: catalogRaw.formsByTable,
    formAccessEntriesByTable,
    documentTemplatesByTable,
    documentTemplateLevels: catalogRaw.documentTemplateLevels ?? {},
    documentTemplateAccessEntriesByTable,
    tableShortIds: Object.fromEntries([...tables, ...formTables, ...documentTemplateTables].map((table) => [table.id, table.shortId])),
    sidebarForms,
    sidebarDocumentTemplates,
  };
};

export const canUseEditModeForCatalog = (catalog: WorkspaceCatalog, user: AuthUser, canManageBase: boolean, canCreateTables: boolean) =>
  canCreateTables ||
  catalog.tables.some((table) => gridsService.permission.hasAtLeast(catalog.tableLevels[table.id] ?? "none", "admin")) ||
  Object.values(catalog.documentTemplateLevels).some((level) => gridsService.permission.hasAtLeast(level, "admin")) ||
  catalog.dashboards.some((dashboard) => dashboard.ownerUserId === user.id || (dashboard.ownerUserId === null && canManageBase)) ||
  Object.values(catalog.workflowLevels).some((level) => gridsService.permission.hasAtLeast(level, "admin"));
