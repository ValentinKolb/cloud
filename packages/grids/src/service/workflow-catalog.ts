import { sql } from "bun";

export type WorkflowCatalogEntry = { id: string; name: string; shortId: string };

export type WorkflowCatalogIndex<T extends WorkflowCatalogEntry> = {
  refs: Map<string, T>;
  ambiguous: Set<string>;
};

export type WorkflowCatalog = {
  tables: WorkflowCatalogIndex<WorkflowCatalogEntry>;
  fieldsByTable: Map<string, WorkflowCatalogIndex<WorkflowCatalogEntry>>;
  templates: WorkflowCatalogIndex<WorkflowCatalogEntry & { tableId: string }>;
  emailTemplates: WorkflowCatalogIndex<WorkflowCatalogEntry>;
};

type WorkflowCatalogInput = {
  tables: WorkflowCatalogEntry[];
  fieldsByTable?: Map<string, WorkflowCatalogEntry[]>;
  templates?: Array<WorkflowCatalogEntry & { tableId: string }>;
  emailTemplates?: WorkflowCatalogEntry[];
};

const createCatalogIndex = <T extends WorkflowCatalogEntry>(): WorkflowCatalogIndex<T> => ({
  refs: new Map<string, T>(),
  ambiguous: new Set<string>(),
});

const addRefAlias = <T extends WorkflowCatalogEntry>(index: WorkflowCatalogIndex<T>, key: string, value: T): void => {
  const existing = index.refs.get(key);
  if (existing && existing.id !== value.id) {
    index.ambiguous.add(key);
    return;
  }
  index.refs.set(key, value);
};

const addRefAliases = <T extends WorkflowCatalogEntry>(index: WorkflowCatalogIndex<T>, value: T): void => {
  addRefAlias(index, value.id, value);
  addRefAlias(index, value.shortId, value);
  addRefAlias(index, value.name, value);
};

export const buildWorkflowCatalog = (input: WorkflowCatalogInput): WorkflowCatalog => {
  const tables = createCatalogIndex<WorkflowCatalogEntry>();
  for (const table of input.tables) addRefAliases(tables, table);
  const fieldsByTable = new Map<string, WorkflowCatalogIndex<WorkflowCatalogEntry>>();
  for (const [tableId, fields] of input.fieldsByTable ?? new Map()) {
    const index = createCatalogIndex<WorkflowCatalogEntry>();
    for (const field of fields) addRefAliases(index, field);
    fieldsByTable.set(tableId, index);
  }
  const templates = createCatalogIndex<WorkflowCatalogEntry & { tableId: string }>();
  for (const template of input.templates ?? []) addRefAliases(templates, template);
  const emailTemplates = createCatalogIndex<WorkflowCatalogEntry>();
  for (const template of input.emailTemplates ?? []) addRefAliases(emailTemplates, template);
  return { tables, fieldsByTable, templates, emailTemplates };
};

export const workflowRefDiagnostic = <T extends WorkflowCatalogEntry>(
  index: WorkflowCatalogIndex<T>,
  key: string,
  label: string,
): string | null => {
  if (index.ambiguous.has(key)) return `${label}: ambiguous reference "${key}"`;
  return index.refs.has(key) ? null : `${label}: unknown reference "${key}"`;
};

export const getWorkflowCatalogRef = <T extends WorkflowCatalogEntry>(index: WorkflowCatalogIndex<T>, key: string): T | null => {
  if (index.ambiguous.has(key)) return null;
  return index.refs.get(key) ?? null;
};

export const loadWorkflowCatalog = async (baseId: string): Promise<WorkflowCatalog> => {
  const tableRows = await sql<{ id: string; short_id: string; name: string }[]>`
    SELECT id::text AS id, short_id, name
    FROM grids.tables
    WHERE base_id = ${baseId}::uuid AND deleted_at IS NULL
  `;
  const tables = createCatalogIndex<WorkflowCatalogEntry>();
  for (const row of tableRows) addRefAliases(tables, { id: row.id, shortId: row.short_id, name: row.name });

  const fieldRows = await sql<{ id: string; short_id: string; table_id: string; name: string }[]>`
    SELECT f.id::text AS id, f.short_id, f.table_id::text AS table_id, f.name
    FROM grids.fields f
    JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
    WHERE t.base_id = ${baseId}::uuid AND f.deleted_at IS NULL
  `;
  const fieldsByTable = new Map<string, WorkflowCatalogIndex<WorkflowCatalogEntry>>();
  for (const row of fieldRows) {
    let fields = fieldsByTable.get(row.table_id);
    if (!fields) {
      fields = createCatalogIndex<WorkflowCatalogEntry>();
      fieldsByTable.set(row.table_id, fields);
    }
    addRefAliases(fields, { id: row.id, shortId: row.short_id, name: row.name });
  }

  const templateRows = await sql<{ id: string; short_id: string; table_id: string; name: string }[]>`
    SELECT dt.id::text AS id, dt.short_id, dt.table_id::text AS table_id, dt.name
    FROM grids.document_templates dt
    JOIN grids.tables t ON t.id = dt.table_id AND t.deleted_at IS NULL
    WHERE t.base_id = ${baseId}::uuid AND dt.deleted_at IS NULL
  `;
  const templates = createCatalogIndex<WorkflowCatalogEntry & { tableId: string }>();
  for (const row of templateRows) {
    addRefAliases(templates, { id: row.id, shortId: row.short_id, tableId: row.table_id, name: row.name });
  }

  const emailTemplateRows = await sql<{ id: string; short_id: string; name: string }[]>`
    SELECT et.id::text AS id, et.short_id, et.name
    FROM grids.email_templates et
    JOIN grids.bases b ON b.id = et.base_id AND b.deleted_at IS NULL
    WHERE et.base_id = ${baseId}::uuid AND et.deleted_at IS NULL
  `;
  const emailTemplates = createCatalogIndex<WorkflowCatalogEntry>();
  for (const row of emailTemplateRows) addRefAliases(emailTemplates, { id: row.id, shortId: row.short_id, name: row.name });

  return { tables, fieldsByTable, templates, emailTemplates };
};

export const resolveWorkflowTableRef = (catalog: WorkflowCatalog, ref: string): WorkflowCatalogEntry | null =>
  getWorkflowCatalogRef(catalog.tables, ref);

export const resolveWorkflowFieldRef = (catalog: WorkflowCatalog, tableId: string, ref: string): WorkflowCatalogEntry | null => {
  const fields = catalog.fieldsByTable.get(tableId);
  return fields ? getWorkflowCatalogRef(fields, ref) : null;
};

export const resolveWorkflowTemplateRef = (catalog: WorkflowCatalog, ref: string): (WorkflowCatalogEntry & { tableId: string }) | null =>
  getWorkflowCatalogRef(catalog.templates, ref);

export const resolveWorkflowEmailTemplateRef = (catalog: WorkflowCatalog, ref: string): WorkflowCatalogEntry | null =>
  getWorkflowCatalogRef(catalog.emailTemplates, ref);
