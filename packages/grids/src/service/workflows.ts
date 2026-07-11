import { isUniqueViolation, toPgTextArray, toPgUuidArray } from "@valentinkolb/cloud/services";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { crypto, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  Workflow,
  WorkflowDefinition,
  WorkflowEmailDelivery,
  WorkflowRun,
  WorkflowRunStats,
  WorkflowRunStatsWindow,
  WorkflowStepRun,
  WorkflowTriggerKind,
} from "../contracts";
import { WorkflowDefinitionSchema } from "../contracts";
import { parseWorkflowYaml } from "../workflows/dsl";
import { logAudit, type SqlClient } from "./audit";
import { listByTable as listFields } from "./fields";
import { compileFilter, renderClause } from "./filter-compiler";
import { parseJsonbRow } from "./jsonb";
import { emitMetadataEvent } from "./metadata-events";
import type { GridsRecordEvent } from "./record-events";
import { insertWithShortId } from "./short-id";
import { validateSchedule } from "./workflow-validators";

type DbRow = Record<string, unknown>;

type CreateRunInput = {
  workflowId: string;
  baseId: string;
  triggerKind: WorkflowTriggerKind;
  triggerKey?: string | null;
  triggerInput?: Record<string, unknown> | null;
  resolvedInput?: Record<string, unknown> | null;
  actorUserId?: string | null;
  actorGroupIds?: string[];
  serviceAccountId?: string | null;
  authorization?: StoredWorkflowAuthorization;
};

type StoredWorkflowAuthorization = { kind: "workflow" } | { kind: "dashboard-widget"; dashboardId: string; dashboardWidgetId: string };

export type RecoverableQueuedWorkflowRun = WorkflowRun & {
  actorGroupIds: string[];
  authorization: unknown;
  queueAttempts: number;
};

type FinishRunInput = {
  status: Extract<WorkflowRun["status"], "succeeded" | "failed" | "canceled">;
  error?: string | null;
  resultMessage?: string | null;
};

type ClaimedWorkflowRun = {
  run: WorkflowRun;
  claimed: boolean;
};

type WorkflowRunCursor = {
  createdAt: string;
  id: string;
};

const DEFAULT_RUN_LEASE_MS = 120_000;
const DEFAULT_STATS_WINDOW: WorkflowRunStatsWindow = "24h";
const STATS_WINDOW_SECONDS: Record<WorkflowRunStatsWindow, number> = {
  "10m": 10 * 60,
  "1h": 60 * 60,
  "12h": 12 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

type ListWorkflowRunsPageParams = {
  baseId: string;
  workflowIds: string[];
  workflowId?: string | null;
  status?: WorkflowRun["status"] | null;
  triggerKind?: WorkflowTriggerKind | null;
  cursor?: string | null;
  limit?: number | null;
};

type ListWorkflowEmailDeliveriesPageParams = {
  baseId: string;
  workflowIds: string[];
  workflowId?: string | null;
  cursor?: string | null;
  limit?: number | null;
};

type WorkflowRunPage = {
  items: WorkflowRun[];
  nextCursor: string | null;
};

type WorkflowEmailDeliveryPage = {
  items: WorkflowEmailDelivery[];
  nextCursor: string | null;
};

type CreateStepRunInput = {
  runId: string;
  stepIndex: number;
  stepPath: string;
  kind: string;
  input?: Record<string, unknown> | null;
};

type FinishStepRunInput = {
  status: Extract<WorkflowStepRun["status"], "succeeded" | "failed" | "canceled">;
  output?: Record<string, unknown> | null;
  error?: string | null;
};

const encodeRunCursor = (run: WorkflowRun): string => `${run.createdAt}|${run.id}`;

const parseRunCursor = (cursor: string | null | undefined): WorkflowRunCursor | null => {
  if (!cursor) return null;
  const [createdAt, id, ...rest] = cursor.split("|");
  if (!createdAt || !id || rest.length > 0) return null;
  return { createdAt, id };
};

export type WorkflowCatalogEntry = { id: string; name: string; shortId: string };
type WorkflowCatalogIndex<T extends WorkflowCatalogEntry> = {
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

type RecordScanCode = {
  id: string;
  baseId: string;
  tableId: string;
  recordId: string;
  code: string;
  active: boolean;
  createdAt: string;
  rotatedAt: string | null;
};

const workflowMetadataEvent = async (
  type: "workflow.created" | "workflow.updated" | "workflow.deleted",
  baseId: string,
  workflowId: string,
  actorId: string | null = null,
): Promise<void> => {
  await emitMetadataEvent({
    type,
    baseId,
    resource: { kind: "workflow", id: workflowId },
    actorId,
  });
};

const mapWorkflowRow = (row: DbRow): Workflow => {
  const rawCompiled = parseJsonbRow<unknown>(row.compiled, {});
  const parsed = WorkflowDefinitionSchema.safeParse(rawCompiled);
  if (!parsed.success) throw err.internal("stored workflow definition is invalid");
  return {
    id: row.id as string,
    shortId: row.short_id as string,
    baseId: row.base_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    source: row.source as string,
    compiled: parsed.data,
    enabled: row.enabled as boolean,
    position: row.position as number,
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
};

const mapRunRow = (row: DbRow): WorkflowRun => ({
  id: row.id as string,
  workflowId: (row.workflow_id as string | null) ?? null,
  baseId: row.base_id as string,
  actorUserId: (row.actor_user_id as string | null) ?? null,
  serviceAccountId: (row.service_account_id as string | null) ?? null,
  triggerKind: row.trigger_kind as WorkflowTriggerKind,
  triggerInput: parseJsonbRow<WorkflowRun["triggerInput"]>(row.trigger_input, null),
  resolvedInput: parseJsonbRow<WorkflowRun["resolvedInput"]>(row.resolved_input, null),
  status: row.status as WorkflowRun["status"],
  error: (row.error as string | null) ?? null,
  resultMessage: (row.result_message as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
  startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
  finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : null,
});

const mapRecoverableRunRow = (row: DbRow): RecoverableQueuedWorkflowRun => ({
  ...mapRunRow(row),
  actorGroupIds: parseJsonbRow<string[]>(row.actor_group_ids, []),
  authorization: parseJsonbRow<unknown>(row.trigger_authorization, null),
  queueAttempts: Number(row.queue_attempts ?? 0),
});

const mapStepRunRow = (row: DbRow): WorkflowStepRun => ({
  id: row.id as string,
  runId: row.run_id as string,
  stepIndex: row.step_index as number,
  stepPath: row.step_path as string,
  kind: row.kind as string,
  status: row.status as WorkflowStepRun["status"],
  input: parseJsonbRow<WorkflowStepRun["input"]>(row.input, null),
  output: parseJsonbRow<WorkflowStepRun["output"]>(row.output, null),
  error: (row.error as string | null) ?? null,
  durationMs: (row.duration_ms as number | null) ?? null,
  startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
  finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : null,
});

const safeString = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

const mapWorkflowEmailDeliveryRow = (row: DbRow): WorkflowEmailDelivery => {
  const diff = parseJsonbRow<Record<string, { new?: unknown }>>(row.diff, {});
  const payload =
    diff.workflowEmail?.new && typeof diff.workflowEmail.new === "object" ? (diff.workflowEmail.new as Record<string, unknown>) : {};
  const recipients = Array.isArray(payload.recipients)
    ? payload.recipients
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
          kind: item.kind === "user" ? ("user" as const) : ("email" as const),
          recipient: safeString(item.recipient) ?? "***",
          ...(safeString(item.notificationId) ? { notificationId: safeString(item.notificationId)! } : {}),
          ...(safeString(item.status) ? { status: safeString(item.status)! } : {}),
        }))
    : [];
  return {
    id: row.id as string,
    workflowId: safeString(payload.workflowId),
    workflowRunId: safeString(payload.workflowRunId),
    templateId: safeString(payload.templateId),
    subject: safeString(payload.subject),
    recipients,
    status: row.action === "workflow.email.failed" ? "failed" : "sent",
    error: safeString(payload.error),
    createdAt: (row.created_at as Date).toISOString(),
  };
};

const mapScanCodeRow = (row: DbRow): RecordScanCode => ({
  id: row.id as string,
  baseId: row.base_id as string,
  tableId: row.table_id as string,
  recordId: row.record_id as string,
  code: row.code as string,
  active: row.active as boolean,
  createdAt: (row.created_at as Date).toISOString(),
  rotatedAt: row.rotated_at ? (row.rotated_at as Date).toISOString() : null,
});

const workflowTimeZone = async (): Promise<string> =>
  normalizeTimeZone(String((await settingsGet<string>("app.timezone")) || "").trim(), "UTC");

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

const refDiagnostic = <T extends WorkflowCatalogEntry>(index: WorkflowCatalogIndex<T>, key: string, label: string): string | null => {
  if (index.ambiguous.has(key)) return `${label}: ambiguous reference "${key}"`;
  return index.refs.has(key) ? null : `${label}: unknown reference "${key}"`;
};

const getCatalogRef = <T extends WorkflowCatalogEntry>(index: WorkflowCatalogIndex<T>, key: string): T | null => {
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
  for (const row of templateRows) addRefAliases(templates, { id: row.id, shortId: row.short_id, tableId: row.table_id, name: row.name });

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
  getCatalogRef(catalog.tables, ref);

export const resolveWorkflowFieldRef = (catalog: WorkflowCatalog, tableId: string, ref: string): WorkflowCatalogEntry | null => {
  const fields = catalog.fieldsByTable.get(tableId);
  return fields ? getCatalogRef(fields, ref) : null;
};

export const resolveWorkflowTemplateRef = (catalog: WorkflowCatalog, ref: string): (WorkflowCatalogEntry & { tableId: string }) | null =>
  getCatalogRef(catalog.templates, ref);

export const resolveWorkflowEmailTemplateRef = (catalog: WorkflowCatalog, ref: string): WorkflowCatalogEntry | null =>
  getCatalogRef(catalog.emailTemplates, ref);

const tableForRecordRef = (
  ref: unknown,
  definition: WorkflowDefinition,
  locals: Map<string, string>,
  catalog: WorkflowCatalog,
): string | null => {
  if (typeof ref !== "string") return null;
  const [root, name] = ref.split(".");
  if (root === "inputs" && name) {
    const input = definition.inputs?.[name];
    if (!input || input.type !== "record" || !input.table) return null;
    return getCatalogRef(catalog.tables, input.table)?.id ?? null;
  }
  return locals.get(root ?? "") ?? null;
};

const tableForRecordListRef = (ref: unknown, definition: WorkflowDefinition, catalog: WorkflowCatalog): string | null => {
  if (typeof ref !== "string") return null;
  const [root, name] = ref.split(".");
  if (root !== "inputs" || !name) return null;
  const input = definition.inputs?.[name];
  if (!input || input.type !== "recordList" || !input.table) return null;
  return getCatalogRef(catalog.tables, input.table)?.id ?? null;
};

const validateFieldRefs = (params: {
  fields: WorkflowCatalogIndex<WorkflowCatalogEntry> | undefined;
  keys: string[];
  label: string;
  diagnostics: string[];
}): void => {
  if (!params.fields) {
    params.diagnostics.push(`${params.label}: unknown table`);
    return;
  }
  for (const key of params.keys) {
    const diagnostic = refDiagnostic(params.fields, key, params.label);
    if (diagnostic) params.diagnostics.push(diagnostic.replace("reference", "field"));
  }
};

const validateStepReferences = (
  steps: unknown[],
  definition: WorkflowDefinition,
  catalog: WorkflowCatalog,
  diagnostics: string[],
  locals = new Map<string, string>(),
): void => {
  for (const step of steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) continue;
    const item = step as Record<string, unknown>;
    if ("updateRecord" in item) {
      const action = item.updateRecord as { record?: unknown; set?: Record<string, unknown> };
      const tableId = tableForRecordRef(action.record, definition, locals, catalog);
      validateFieldRefs({
        fields: tableId ? catalog.fieldsByTable.get(tableId) : undefined,
        keys: Object.keys(action.set ?? {}),
        label: "updateRecord.set",
        diagnostics,
      });
    } else if ("createRecord" in item) {
      const action = item.createRecord as { table?: unknown; values?: Record<string, unknown> };
      const table = typeof action.table === "string" ? getCatalogRef(catalog.tables, action.table) : null;
      if (!table)
        diagnostics.push(
          refDiagnostic(catalog.tables, String(action.table ?? ""), "createRecord.table") ?? "createRecord.table: unknown table",
        );
      validateFieldRefs({
        fields: table ? catalog.fieldsByTable.get(table.id) : undefined,
        keys: Object.keys(action.values ?? {}),
        label: "createRecord.values",
        diagnostics,
      });
    } else if ("generateDocument" in item) {
      const action = item.generateDocument as { template?: unknown; record?: unknown };
      const template = typeof action.template === "string" ? getCatalogRef(catalog.templates, action.template) : null;
      if (!template)
        diagnostics.push(
          refDiagnostic(catalog.templates, String(action.template ?? ""), "generateDocument.template") ??
            "generateDocument.template: unknown document template",
        );
      const tableId = tableForRecordRef(action.record, definition, locals, catalog);
      if (template && tableId && template.tableId !== tableId)
        diagnostics.push("generateDocument.record: record table must match the document template table");
    } else if ("sendEmail" in item) {
      const action = item.sendEmail as { template?: unknown };
      const template = typeof action.template === "string" ? getCatalogRef(catalog.emailTemplates, action.template) : null;
      if (!template)
        diagnostics.push(
          refDiagnostic(catalog.emailTemplates, String(action.template ?? ""), "sendEmail.template") ??
            "sendEmail.template: unknown email template",
        );
    } else if ("forEach" in item) {
      const tableId = tableForRecordListRef(item.forEach, definition, catalog);
      const nextLocals = new Map(locals);
      if (tableId && typeof item.as === "string") nextLocals.set(item.as, tableId);
      if (Array.isArray(item.do)) validateStepReferences(item.do, definition, catalog, diagnostics, nextLocals);
    } else if ("if" in item) {
      if (Array.isArray(item.then)) validateStepReferences(item.then, definition, catalog, diagnostics, locals);
      if (Array.isArray(item.else)) validateStepReferences(item.else, definition, catalog, diagnostics, locals);
    } else if ("switch" in item) {
      if (Array.isArray(item.cases)) {
        for (const caseItem of item.cases) {
          if (caseItem && typeof caseItem === "object" && Array.isArray((caseItem as { do?: unknown }).do)) {
            validateStepReferences((caseItem as { do: unknown[] }).do, definition, catalog, diagnostics, locals);
          }
        }
      }
      if (Array.isArray(item.default)) validateStepReferences(item.default, definition, catalog, diagnostics, locals);
    }
  }
};

export const validateWorkflowReferences = (definition: WorkflowDefinition, catalog: WorkflowCatalog): string[] => {
  const diagnostics: string[] = [];
  for (const [name, input] of Object.entries(definition.inputs ?? {})) {
    if ((input.type === "record" || input.type === "recordList") && input.table) {
      const diagnostic = refDiagnostic(catalog.tables, input.table, `inputs.${name}.table`);
      if (diagnostic) diagnostics.push(diagnostic.replace("reference", "table"));
    }
  }
  const scanner = definition.triggers.scanner;
  if (scanner?.resolve?.by === "field") {
    const input = definition.inputs?.[scanner.input];
    const table = input?.table ? getCatalogRef(catalog.tables, input.table) : null;
    const fields = table ? catalog.fieldsByTable.get(table.id) : undefined;
    if (!scanner.resolve.field) {
      diagnostics.push("triggers.scanner.resolve.field: unknown field");
    } else if (!fields) {
      diagnostics.push("triggers.scanner.resolve.field: unknown table");
    } else {
      const diagnostic = refDiagnostic(fields, scanner.resolve.field, "triggers.scanner.resolve.field");
      if (diagnostic) diagnostics.push(diagnostic.replace("reference", "field"));
    }
  }
  const schedule = definition.triggers.schedule;
  if (schedule) {
    const validation = validateSchedule({ kind: "schedule", cron: schedule.cron, timezone: schedule.timezone });
    if (!validation.ok) diagnostics.push(`triggers.schedule: ${validation.error.message}`);
  }
  const recordEvent = definition.triggers.recordEvent;
  const recordEventTable = recordEvent?.table;
  if (recordEventTable) {
    const diagnostic = refDiagnostic(catalog.tables, recordEventTable, "triggers.recordEvent.table");
    if (diagnostic) diagnostics.push(diagnostic.replace("reference", "table"));
  }
  if (recordEvent?.filter && !recordEventTable && !recordEvent.input) {
    diagnostics.push("triggers.recordEvent.filter: filters require either table or input");
  }
  if (recordEvent?.input) {
    const input = definition.inputs?.[recordEvent.input];
    if (!input || input.type !== "record" || !input.table) {
      diagnostics.push("triggers.recordEvent.input: input must reference a record input with a table");
    } else {
      const inputTable = getCatalogRef(catalog.tables, input.table);
      const triggerTable = recordEventTable ? getCatalogRef(catalog.tables, recordEventTable) : null;
      if (recordEventTable && inputTable && triggerTable && inputTable.id !== triggerTable.id) {
        diagnostics.push("triggers.recordEvent.input: input table must match triggers.recordEvent.table");
      }
    }
  }
  validateStepReferences(definition.steps, definition, catalog, diagnostics);
  return diagnostics;
};

const validateBaseReferences = async (baseId: string, definition: WorkflowDefinition): Promise<Result<void>> => {
  const catalog = await loadWorkflowCatalog(baseId);
  const diagnostics = validateWorkflowReferences(definition, catalog);
  const recordEvent = definition.triggers.recordEvent;
  if (recordEvent?.filter && (recordEvent.table || recordEvent.input)) {
    const input = recordEvent.input ? definition.inputs?.[recordEvent.input] : null;
    const tableRef = recordEvent.table ?? (input?.type === "record" ? input.table : null);
    const table = tableRef ? getCatalogRef(catalog.tables, tableRef) : null;
    if (table) {
      const fields = await listFields(table.id);
      const compiled = compileFilter(recordEvent.filter, fields, { timeZone: await workflowTimeZone() });
      if (!compiled.ok) diagnostics.push(`triggers.recordEvent.filter: ${compiled.error}`);
    }
  }
  return diagnostics.length > 0 ? fail(err.badInput(diagnostics.join("; "))) : ok();
};

const compileSource = async (baseId: string, source: string): Promise<Result<Workflow["compiled"]>> => {
  const parsed = parseWorkflowYaml(source);
  if (parsed.ok) {
    const refs = await validateBaseReferences(baseId, parsed.definition);
    return refs.ok ? ok(parsed.definition) : fail(refs.error);
  }
  const message = parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
  return fail(err.badInput(message || "workflow YAML is invalid"));
};

export const get = async (id: string, opts: { includeDeleted?: boolean } = {}): Promise<Workflow | null> => {
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
               w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
        FROM grids.workflows w
        JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
        WHERE w.id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
               w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
        FROM grids.workflows w
        JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
        WHERE w.id = ${id}::uuid AND w.deleted_at IS NULL
      `;
  return row ? mapWorkflowRow(row) : null;
};

export const getByShortId = async (baseId: string, shortId: string): Promise<Workflow | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
           w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.base_id = ${baseId}::uuid AND w.short_id = ${shortId} AND w.deleted_at IS NULL
  `;
  return row ? mapWorkflowRow(row) : null;
};

export const getByIdOrShortId = async (baseId: string, idOrShortId: string): Promise<Workflow | null> => {
  if (idOrShortId.length === 36 && idOrShortId.includes("-")) {
    const workflow = await get(idOrShortId);
    return workflow && workflow.baseId === baseId ? workflow : null;
  }
  return getByShortId(baseId, idOrShortId);
};

export const listForBase = async (baseId: string): Promise<Workflow[]> => {
  const rows = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
           w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.base_id = ${baseId}::uuid AND w.deleted_at IS NULL
    ORDER BY w.position, w.created_at, w.id
  `;
  return rows.map(mapWorkflowRow);
};

export const listEnabledForBase = async (baseId: string): Promise<Workflow[]> => {
  const rows = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
           w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.base_id = ${baseId}::uuid AND w.deleted_at IS NULL AND w.enabled = TRUE
    ORDER BY w.position, w.created_at, w.id
  `;
  return rows.map(mapWorkflowRow);
};

export const listScheduledEnabled = async (): Promise<Workflow[]> => {
  const rows = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
           w.owner_user_id, w.deleted_at, w.created_at, w.updated_at
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.deleted_at IS NULL
      AND w.enabled = TRUE
      AND w.compiled->'triggers' ? 'schedule'
    ORDER BY w.created_at, w.id
  `;
  return rows.map(mapWorkflowRow);
};

// Consumed through the injected workflow store namespace in workflow-trigger-runtime.
// fallow-ignore-next-line unused-export
export const listRecordEventBaseIds = async (): Promise<string[]> => {
  const rows = await sql<Array<{ id: string }>>`
    SELECT DISTINCT w.base_id::text AS id
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.deleted_at IS NULL
      AND w.enabled = TRUE
      AND w.compiled->'triggers' ? 'recordEvent'
      AND w.record_event_active_since IS NOT NULL
    ORDER BY id
  `;
  return rows.map((row) => row.id);
};

const workflowRecordEventName = (event: GridsRecordEvent): "created" | "updated" | "deleted" | null => {
  switch (event.type) {
    case "record.created":
      return "created";
    case "record.updated":
      return "updated";
    case "record.deleted":
      return "deleted";
    case "record.restored":
      return null;
  }
};

const recordEventTableId = (workflow: Workflow, catalog: WorkflowCatalog): string | null => {
  const trigger = workflow.compiled.triggers.recordEvent;
  if (!trigger) return null;
  if (trigger.table) return resolveWorkflowTableRef(catalog, trigger.table)?.id ?? null;
  if (trigger.input) {
    const input = workflow.compiled.inputs?.[trigger.input];
    return input?.type === "record" && input.table ? (resolveWorkflowTableRef(catalog, input.table)?.id ?? null) : null;
  }
  return null;
};

export const listRecordEventEnabled = async (event: GridsRecordEvent): Promise<Workflow[]> => {
  const eventName = workflowRecordEventName(event);
  if (!eventName) return [];
  const occurredAt = Date.parse(event.occurredAt);
  if (!Number.isFinite(occurredAt)) return [];
  const rows = await sql<DbRow[]>`
    SELECT w.id, w.short_id, w.base_id, w.name, w.description, w.source, w.compiled, w.enabled, w.position,
           w.owner_user_id, w.deleted_at, w.created_at, w.updated_at, w.record_event_active_since
    FROM grids.workflows w
    JOIN grids.bases b ON b.id = w.base_id AND b.deleted_at IS NULL
    WHERE w.base_id = ${event.baseId}::uuid
      AND w.deleted_at IS NULL
      AND w.enabled = TRUE
      AND w.compiled->'triggers' ? 'recordEvent'
      AND w.record_event_active_since IS NOT NULL
      AND w.record_event_active_since <= ${event.occurredAt}::timestamptz
    ORDER BY w.position, w.created_at, w.id
  `;
  const workflows = rows.map(mapWorkflowRow);
  const catalog = await loadWorkflowCatalog(event.baseId);
  return workflows.filter((workflow) => {
    const trigger = workflow.compiled.triggers.recordEvent;
    if (!trigger || trigger.event !== eventName) return false;
    const tableId = recordEventTableId(workflow, catalog);
    return !tableId || tableId === event.tableId;
  });
};

export const recordMatchesWorkflowFilter = async (workflow: Workflow, event: GridsRecordEvent): Promise<Result<boolean>> => {
  const trigger = workflow.compiled.triggers.recordEvent;
  if (!trigger?.filter) return ok(true);
  const catalog = await loadWorkflowCatalog(workflow.baseId);
  const tableId = recordEventTableId(workflow, catalog);
  if (!tableId) return fail(err.badInput("recordEvent filters require a table or record input"));
  const fields = await listFields(tableId);
  const compiled = compileFilter(trigger.filter, fields, { timeZone: await workflowTimeZone() });
  if (!compiled.ok) return fail(err.badInput(`workflow recordEvent filter is invalid: ${compiled.error}`));
  const clause = renderClause(compiled.clause);
  const [row] = await sql<{ matched: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM grids.records r
      WHERE r.id = ${event.recordId}::uuid
        AND r.table_id = ${tableId}::uuid
        AND ${event.type === "record.deleted" ? sql`TRUE` : sql`r.deleted_at IS NULL`}
        AND ${clause}
    ) AS matched
  `;
  return ok(Boolean(row?.matched));
};

export const create = async (baseId: string, input: CreateWorkflowInput, actorId: string | null): Promise<Result<Workflow>> => {
  const compiled = await compileSource(baseId, input.source);
  if (!compiled.ok) return compiled;
  const recordEventActive = Boolean(input.enabled && compiled.data.triggers.recordEvent);

  const workflow = await sql.begin(async (tx): Promise<Workflow> => {
    const row = await insertWithShortId(async (shortId) => {
      const [inserted] = await tx<DbRow[]>`
          INSERT INTO grids.workflows (
            short_id, base_id, name, description, source, compiled, enabled, position, owner_user_id, record_event_active_since
          )
          VALUES (
            ${shortId},
            ${baseId}::uuid,
            ${input.name.trim()},
            ${input.description ?? null},
            ${input.source},
            ${compiled.data}::jsonb,
            ${input.enabled ?? false},
            ${input.position ?? 0},
            ${actorId}::uuid,
            ${recordEventActive ? sql`now()` : null}
          )
          RETURNING id, short_id, base_id, name, description, source, compiled, enabled, position, owner_user_id, deleted_at, created_at, updated_at
        `;
      if (!inserted) throw err.internal("workflow insert failed");
      return inserted;
    }, "idx_grids_workflows_short_id");
    const created = mapWorkflowRow(row);
    await logAudit(
      {
        baseId,
        userId: actorId,
        action: "workflow.created",
        diff: { workflow: { old: null, new: { id: created.id, name: created.name, enabled: created.enabled } } },
      },
      tx,
    );
    return created;
  });
  await workflowMetadataEvent("workflow.created", baseId, workflow.id, actorId);
  return ok(workflow);
};

export const update = async (id: string, input: UpdateWorkflowInput, actorId: string | null): Promise<Result<Workflow>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("workflow"));
  const nextSource = input.source ?? existing.source;
  const compiled = input.source === undefined ? ok(existing.compiled) : await compileSource(existing.baseId, nextSource);
  if (!compiled.ok) return compiled;
  const nextEnabled = input.enabled ?? existing.enabled;
  const existingRecordEvent = existing.compiled.triggers.recordEvent ?? null;
  const nextRecordEvent = compiled.data.triggers.recordEvent ?? null;
  const recordEventChanged = JSON.stringify(existingRecordEvent) !== JSON.stringify(nextRecordEvent);
  const activateRecordEvent = Boolean(nextEnabled && nextRecordEvent && (!existing.enabled || !existingRecordEvent || recordEventChanged));
  const deactivateRecordEvent = !nextEnabled || !nextRecordEvent;

  const workflow = await sql.begin(async (tx): Promise<Workflow> => {
    const [row] = await tx<DbRow[]>`
      UPDATE grids.workflows
      SET name = ${input.name === undefined ? existing.name : input.name.trim()},
          description = ${input.description === undefined ? existing.description : input.description},
          source = ${nextSource},
          compiled = ${compiled.data}::jsonb,
          enabled = ${nextEnabled},
          position = ${input.position ?? existing.position},
          record_event_active_since = CASE
            WHEN ${deactivateRecordEvent} THEN NULL
            WHEN ${activateRecordEvent} THEN now()
            ELSE record_event_active_since
          END,
          updated_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      RETURNING id, short_id, base_id, name, description, source, compiled, enabled, position, owner_user_id, deleted_at, created_at, updated_at
    `;
    if (!row) throw err.notFound("workflow");
    const updated = mapWorkflowRow(row);
    await logAudit(
      {
        baseId: updated.baseId,
        userId: actorId,
        action: "workflow.updated",
        diff: {
          workflow: {
            old: { id: existing.id, name: existing.name, enabled: existing.enabled },
            new: { id: updated.id, name: updated.name, enabled: updated.enabled },
          },
        },
      },
      tx,
    );
    return updated;
  });
  await workflowMetadataEvent("workflow.updated", workflow.baseId, workflow.id, actorId);
  return ok(workflow);
};

export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("workflow"));
  const result = await sql.begin(async (tx): Promise<Result<void>> => {
    const updated = await tx`
      UPDATE grids.workflows
      SET deleted_at = now(), enabled = FALSE, updated_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
    `;
    if (updated.count === 0) return fail(err.notFound("workflow"));
    await logAudit(
      {
        baseId: existing.baseId,
        userId: actorId,
        action: "workflow.deleted",
        diff: { workflow: { old: { id: existing.id, name: existing.name }, new: null } },
      },
      tx,
    );
    return ok();
  });
  if (result.ok) await workflowMetadataEvent("workflow.deleted", existing.baseId, existing.id, actorId);
  return result;
};

export const createWorkflowRun = async (input: CreateRunInput, client: SqlClient = sql): Promise<RecoverableQueuedWorkflowRun> => {
  const [row] = await client<DbRow[]>`
    INSERT INTO grids.workflow_runs (
      workflow_id, base_id, actor_user_id, actor_group_ids, service_account_id, trigger_authorization, trigger_kind,
      trigger_key, trigger_input, resolved_input, status
    )
    VALUES (
      ${input.workflowId}::uuid,
      ${input.baseId}::uuid,
      ${input.actorUserId ?? null}::uuid,
      ${toPgUuidArray(input.actorGroupIds ?? [])}::uuid[],
      ${input.serviceAccountId ?? null}::uuid,
      ${input.authorization ?? { kind: "workflow" }}::jsonb,
      ${input.triggerKind},
      ${input.triggerKey ?? null},
      ${input.triggerInput ?? null}::jsonb,
      ${input.resolvedInput ?? null}::jsonb,
      'queued'
    )
    ON CONFLICT (workflow_id, trigger_kind, trigger_key)
    WHERE trigger_key IS NOT NULL AND workflow_id IS NOT NULL
    DO UPDATE SET trigger_key = grids.workflow_runs.trigger_key
    RETURNING id, workflow_id, base_id, actor_user_id, to_json(actor_group_ids) AS actor_group_ids,
              service_account_id, trigger_authorization,
              trigger_kind, trigger_input, resolved_input, status, error, result_message, queue_attempts,
              created_at, started_at, finished_at
  `;
  if (!row) throw err.internal("workflow run insert failed");
  return mapRecoverableRunRow(row);
};

export const claimStaleQueuedRuns = async (staleMs = 30_000, limit = 100): Promise<RecoverableQueuedWorkflowRun[]> => {
  const cap = Math.min(Math.max(limit, 1), 500);
  const rows = await sql<DbRow[]>`
    WITH candidates AS (
      SELECT id
      FROM grids.workflow_runs
      WHERE status = 'queued'
        AND created_at < now() - (${staleMs} * interval '1 millisecond')
        AND (last_queue_attempt_at IS NULL OR last_queue_attempt_at < now() - (${staleMs} * interval '1 millisecond'))
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT ${cap}
    )
    UPDATE grids.workflow_runs wr
    SET queue_attempts = queue_attempts + 1,
        last_queue_attempt_at = now()
    FROM candidates c
    WHERE wr.id = c.id
    RETURNING wr.id, wr.workflow_id, wr.base_id, wr.actor_user_id, to_json(wr.actor_group_ids) AS actor_group_ids,
              wr.service_account_id,
              wr.trigger_authorization, wr.trigger_kind, wr.trigger_input, wr.resolved_input, wr.status, wr.error,
              wr.result_message, wr.queue_attempts, wr.created_at, wr.started_at, wr.finished_at
  `;
  return rows.map(mapRecoverableRunRow);
};

export const failQueuedRunAttempt = async (
  runId: string,
  queueAttempt: number,
  error: string,
  client: SqlClient = sql,
): Promise<WorkflowRun | null> => {
  const [row] = await client<DbRow[]>`
    UPDATE grids.workflow_runs
    SET status = 'failed',
        error = ${error},
        lease_expires_at = NULL,
        finished_at = now()
    WHERE id = ${runId}::uuid
      AND status = 'queued'
      AND queue_attempts = ${queueAttempt}
    RETURNING id, workflow_id, base_id, actor_user_id, service_account_id, trigger_kind, trigger_input,
              resolved_input, status, error, result_message, created_at, started_at, finished_at
  `;
  if (!row) return null;
  await logAudit(
    {
      baseId: row.base_id as string,
      userId: (row.actor_user_id as string | null) ?? null,
      action: "workflow.run.failed",
      diff: {
        workflowRun: {
          old: null,
          new: {
            id: row.id,
            workflowId: row.workflow_id,
            serviceAccountId: row.service_account_id,
            status: "failed",
          },
        },
      },
    },
    client,
  );
  return mapRunRow(row);
};

export const claimRun = async (runId: string, client: SqlClient = sql, leaseMs = DEFAULT_RUN_LEASE_MS): Promise<ClaimedWorkflowRun> => {
  const [row] = await client<DbRow[]>`
    UPDATE grids.workflow_runs
    SET status = 'running',
        started_at = COALESCE(started_at, now()),
        heartbeat_at = now(),
        lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
    WHERE id = ${runId}::uuid
      AND (
        status = 'queued'
        OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
      )
    RETURNING id, workflow_id, base_id, actor_user_id, service_account_id, trigger_kind, trigger_input,
              resolved_input, status, error, result_message, created_at, started_at, finished_at
  `;
  if (!row) {
    const existing = await getWorkflowRun(runId);
    if (existing) return { run: existing, claimed: false };
    throw err.notFound("workflow run");
  }
  await logAudit(
    {
      baseId: row.base_id as string,
      userId: (row.actor_user_id as string | null) ?? null,
      action: "workflow.run.started",
      diff: {
        workflowRun: {
          old: null,
          new: {
            id: row.id,
            workflowId: row.workflow_id,
            serviceAccountId: row.service_account_id,
            triggerKind: row.trigger_kind,
          },
        },
      },
    },
    client,
  );
  return { run: mapRunRow(row), claimed: true };
};

export const heartbeatRun = async (runId: string, leaseMs = DEFAULT_RUN_LEASE_MS, client: SqlClient = sql): Promise<void> => {
  await client`
    UPDATE grids.workflow_runs
    SET heartbeat_at = now(),
        lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
    WHERE id = ${runId}::uuid AND status = 'running'
  `;
};

export const finishRun = async (runId: string, input: FinishRunInput, client: SqlClient = sql): Promise<WorkflowRun> => {
  const [row] = await client<DbRow[]>`
    UPDATE grids.workflow_runs
    SET status = ${input.status},
        error = ${input.error ?? null},
        result_message = ${input.resultMessage ?? null},
        lease_expires_at = NULL,
        finished_at = now()
    WHERE id = ${runId}::uuid
    RETURNING id, workflow_id, base_id, actor_user_id, service_account_id, trigger_kind, trigger_input,
              resolved_input, status, error, result_message, created_at, started_at, finished_at
  `;
  if (!row) throw err.notFound("workflow run");
  await logAudit(
    {
      baseId: row.base_id as string,
      userId: (row.actor_user_id as string | null) ?? null,
      action: input.status === "succeeded" ? "workflow.run.succeeded" : "workflow.run.failed",
      diff: {
        workflowRun: {
          old: null,
          new: {
            id: row.id,
            workflowId: row.workflow_id,
            serviceAccountId: row.service_account_id,
            status: input.status,
          },
        },
      },
    },
    client,
  );
  return mapRunRow(row);
};

export const listRuns = async (workflowId: string, limit = 50): Promise<WorkflowRun[]> => {
  const cap = Math.min(Math.max(limit, 1), 200);
  const rows = await sql<DbRow[]>`
    SELECT id, workflow_id, base_id, actor_user_id, service_account_id, trigger_kind, trigger_input,
           resolved_input, status, error, result_message, created_at, started_at, finished_at
    FROM grids.workflow_runs
    WHERE workflow_id = ${workflowId}::uuid
    ORDER BY created_at DESC, id DESC
    LIMIT ${cap}
  `;
  return rows.map(mapRunRow);
};

export const listRunsPage = async (params: ListWorkflowRunsPageParams): Promise<WorkflowRunPage> => {
  if (params.workflowIds.length === 0) return { items: [], nextCursor: null };
  const cap = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const workflowIds = toPgUuidArray(params.workflowIds);
  const cursor = parseRunCursor(params.cursor);
  const workflowIdClause = params.workflowId ? sql`AND workflow_id = ${params.workflowId}::uuid` : sql``;
  const statusClause = params.status ? sql`AND status = ${params.status}` : sql``;
  const triggerClause = params.triggerKind ? sql`AND trigger_kind = ${params.triggerKind}` : sql``;
  const cursorClause = cursor ? sql`AND (created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``;
  const rows = await sql<DbRow[]>`
    SELECT id, workflow_id, base_id, actor_user_id, service_account_id, trigger_kind, trigger_input,
           resolved_input, status, error, result_message, created_at, started_at, finished_at
    FROM grids.workflow_runs
    WHERE base_id = ${params.baseId}::uuid
      AND workflow_id = ANY(${workflowIds}::uuid[])
      ${workflowIdClause}
      ${statusClause}
      ${triggerClause}
      ${cursorClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ${cap + 1}
  `;
  const mapped = rows.map(mapRunRow);
  const items = mapped.slice(0, cap);
  const nextCursor = mapped.length > cap && items.length > 0 ? encodeRunCursor(items[items.length - 1]!) : null;
  return { items, nextCursor };
};

export const listEmailDeliveriesPage = async (params: ListWorkflowEmailDeliveriesPageParams): Promise<WorkflowEmailDeliveryPage> => {
  if (params.workflowIds.length === 0) return { items: [], nextCursor: null };
  const cap = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const workflowIds = toPgTextArray(params.workflowIds);
  const cursor = parseRunCursor(params.cursor);
  const workflowIdClause = params.workflowId ? sql`AND diff #>> '{workflowEmail,new,workflowId}' = ${params.workflowId}` : sql``;
  const cursorClause = cursor ? sql`AND (created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``;
  const rows = await sql<DbRow[]>`
    SELECT id, base_id, table_id, record_id, user_id, action, diff, ip, user_agent, created_at
    FROM grids.audit_log
    WHERE base_id = ${params.baseId}::uuid
      AND action IN ('workflow.email.sent', 'workflow.email.failed')
      AND diff #>> '{workflowEmail,new,workflowId}' = ANY(${workflowIds}::text[])
      ${workflowIdClause}
      ${cursorClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ${cap + 1}
  `;
  const mapped = rows.map(mapWorkflowEmailDeliveryRow);
  const items = mapped.slice(0, cap);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: mapped.length > cap && last ? `${last.createdAt}|${last.id}` : null,
  };
};

type WorkflowRunStatsRow = WorkflowRunStats["byWorkflow"][number];

type RunStatsSqlRow = {
  total: number | string;
  queued: number | string;
  running: number | string;
  succeeded: number | string;
  failed: number | string;
  canceled: number | string;
  failed_last_24h?: number | string;
  avg_duration_ms: number | string | null;
  p99_duration_ms: number | string | null;
  last_run_at: Date | string | null;
};

type WorkflowRunStatsSqlRow = RunStatsSqlRow & {
  workflow_id: string;
  latest_status: WorkflowRun["status"] | null;
};

const emptyRunStats = (window: WorkflowRunStatsWindow): WorkflowRunStats => ({
  window,
  total: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
  failedLast24h: 0,
  errorRate: 0,
  avgDurationMs: null,
  p99DurationMs: null,
  lastRunAt: null,
  byWorkflow: [],
});

const numberOrNull = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const intCount = (value: number | string | null | undefined): number => Math.max(0, Math.trunc(numberOrNull(value) ?? 0));

const errorRate = (failed: number, total: number): number => (total > 0 ? (failed / total) * 100 : 0);

const mapStatsRow = (
  row: RunStatsSqlRow | undefined,
  window: WorkflowRunStatsWindow,
  byWorkflow: WorkflowRunStatsRow[],
): WorkflowRunStats => {
  const total = intCount(row?.total);
  const failed = intCount(row?.failed);
  return {
    window,
    total,
    queued: intCount(row?.queued),
    running: intCount(row?.running),
    succeeded: intCount(row?.succeeded),
    failed,
    canceled: intCount(row?.canceled),
    failedLast24h: intCount(row?.failed_last_24h),
    errorRate: errorRate(failed, total),
    avgDurationMs: numberOrNull(row?.avg_duration_ms),
    p99DurationMs: numberOrNull(row?.p99_duration_ms),
    lastRunAt: row?.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    byWorkflow,
  };
};

const mapWorkflowStatsRow = (row: WorkflowRunStatsSqlRow): WorkflowRunStatsRow => {
  const total = intCount(row.total);
  const failed = intCount(row.failed);
  return {
    workflowId: row.workflow_id,
    total,
    queued: intCount(row.queued),
    running: intCount(row.running),
    succeeded: intCount(row.succeeded),
    failed,
    canceled: intCount(row.canceled),
    errorRate: errorRate(failed, total),
    avgDurationMs: numberOrNull(row.avg_duration_ms),
    p99DurationMs: numberOrNull(row.p99_duration_ms),
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    latestStatus: row.latest_status,
  };
};

export const runStats = async (
  baseId: string,
  workflowIds: string[],
  options: { window?: WorkflowRunStatsWindow | null } = {},
): Promise<WorkflowRunStats> => {
  const window = options.window ?? DEFAULT_STATS_WINDOW;
  if (workflowIds.length === 0) {
    return emptyRunStats(window);
  }
  const ids = toPgUuidArray(workflowIds);
  const windowSeconds = STATS_WINDOW_SECONDS[window];
  const [row] = await sql<RunStatsSqlRow[]>`
    WITH filtered AS (
      SELECT
        status,
        created_at,
        CASE
          WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
          THEN GREATEST(0, EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)
          ELSE NULL
        END AS duration_ms
      FROM grids.workflow_runs
      WHERE base_id = ${baseId}::uuid
        AND workflow_id = ANY(${ids}::uuid[])
        AND created_at >= now() - (${windowSeconds} * interval '1 second')
    ),
    failed_24h AS (
      SELECT count(*)::int AS failed_last_24h
      FROM grids.workflow_runs
      WHERE base_id = ${baseId}::uuid
        AND workflow_id = ANY(${ids}::uuid[])
        AND status = 'failed'
        AND created_at >= now() - interval '24 hours'
    )
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'queued')::int AS queued,
      count(*) FILTER (WHERE status = 'running')::int AS running,
      count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status = 'canceled')::int AS canceled,
      (SELECT failed_last_24h FROM failed_24h) AS failed_last_24h,
      round((avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::numeric)::int AS avg_duration_ms,
      round((percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::numeric)::int AS p99_duration_ms,
      max(created_at) AS last_run_at
    FROM filtered
  `;
  const workflowRows = await sql<WorkflowRunStatsSqlRow[]>`
    WITH filtered AS (
      SELECT
        id,
        workflow_id::text AS workflow_id,
        status,
        created_at,
        CASE
          WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
          THEN GREATEST(0, EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)
          ELSE NULL
        END AS duration_ms
      FROM grids.workflow_runs
      WHERE base_id = ${baseId}::uuid
        AND workflow_id = ANY(${ids}::uuid[])
        AND created_at >= now() - (${windowSeconds} * interval '1 second')
    ),
    latest AS (
      SELECT DISTINCT ON (workflow_id) workflow_id, status AS latest_status
      FROM filtered
      ORDER BY workflow_id, created_at DESC, id DESC
    )
    SELECT
      f.workflow_id,
      count(*)::int AS total,
      count(*) FILTER (WHERE f.status = 'queued')::int AS queued,
      count(*) FILTER (WHERE f.status = 'running')::int AS running,
      count(*) FILTER (WHERE f.status = 'succeeded')::int AS succeeded,
      count(*) FILTER (WHERE f.status = 'failed')::int AS failed,
      count(*) FILTER (WHERE f.status = 'canceled')::int AS canceled,
      round((avg(f.duration_ms) FILTER (WHERE f.duration_ms IS NOT NULL))::numeric)::int AS avg_duration_ms,
      round((percentile_cont(0.99) WITHIN GROUP (ORDER BY f.duration_ms) FILTER (WHERE f.duration_ms IS NOT NULL))::numeric)::int AS p99_duration_ms,
      max(f.created_at) AS last_run_at,
      latest.latest_status
    FROM filtered f
    JOIN latest ON latest.workflow_id = f.workflow_id
    GROUP BY f.workflow_id, latest.latest_status
    ORDER BY max(f.created_at) DESC, f.workflow_id
  `;
  return mapStatsRow(row, window, workflowRows.map(mapWorkflowStatsRow));
};

export const getWorkflowRun = async (runId: string): Promise<WorkflowRun | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, workflow_id, base_id, actor_user_id, service_account_id, trigger_kind, trigger_input,
           resolved_input, status, error, result_message, created_at, started_at, finished_at
    FROM grids.workflow_runs
    WHERE id = ${runId}::uuid
  `;
  return row ? mapRunRow(row) : null;
};

export const createStepRun = async (input: CreateStepRunInput, client: SqlClient = sql): Promise<WorkflowStepRun> => {
  const [row] = await client<DbRow[]>`
    INSERT INTO grids.workflow_step_runs (run_id, step_index, step_path, resume_key, kind, status, input, started_at)
    VALUES (${input.runId}::uuid, ${input.stepIndex}, ${input.stepPath}, ${input.stepPath}, ${input.kind}, 'running', ${input.input ?? null}::jsonb, now())
    ON CONFLICT (run_id, resume_key) WHERE resume_key IS NOT NULL
    DO UPDATE SET
      status = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.status ELSE 'running' END,
      input = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.input ELSE EXCLUDED.input END,
      output = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.output ELSE NULL END,
      error = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.error ELSE NULL END,
      duration_ms = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.duration_ms ELSE NULL END,
      started_at = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.started_at ELSE now() END,
      finished_at = CASE WHEN grids.workflow_step_runs.status = 'succeeded' THEN grids.workflow_step_runs.finished_at ELSE NULL END
    RETURNING id, run_id, step_index, step_path, kind, status, input, output, error, duration_ms, started_at, finished_at
  `;
  if (!row) throw err.internal("workflow step run insert failed");
  return mapStepRunRow(row);
};

export const getStepRunByPath = async (runId: string, stepPath: string, client: SqlClient = sql): Promise<WorkflowStepRun | null> => {
  const [row] = await client<DbRow[]>`
    SELECT id, run_id, step_index, step_path, kind, status, input, output, error, duration_ms, started_at, finished_at
    FROM grids.workflow_step_runs
    WHERE run_id = ${runId}::uuid
      AND resume_key = ${stepPath}
  `;
  return row ? mapStepRunRow(row) : null;
};

export const finishStepRun = async (stepRunId: string, input: FinishStepRunInput, client: SqlClient = sql): Promise<WorkflowStepRun> => {
  const [row] = await client<DbRow[]>`
    UPDATE grids.workflow_step_runs
    SET status = ${input.status},
        output = ${input.output ?? null}::jsonb,
        error = ${input.error ?? null},
        duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(started_at, now()))) * 1000)::int),
        finished_at = now()
    WHERE id = ${stepRunId}::uuid
    RETURNING id, run_id, step_index, step_path, kind, status, input, output, error, duration_ms, started_at, finished_at
  `;
  if (!row) throw err.notFound("workflow step run");
  return mapStepRunRow(row);
};

export const listStepRuns = async (runId: string): Promise<WorkflowStepRun[]> => {
  const rows = await sql<DbRow[]>`
    SELECT id, run_id, step_index, step_path, kind, status, input, output, error, duration_ms, started_at, finished_at
    FROM grids.workflow_step_runs
    WHERE run_id = ${runId}::uuid
    ORDER BY step_index, id
  `;
  return rows.map(mapStepRunRow);
};

export const getOrCreateRecordScanCode = async (params: {
  baseId: string;
  tableId: string;
  recordId: string;
  code: string;
  client?: SqlClient;
}): Promise<RecordScanCode> => {
  const client = params.client ?? sql;
  const [row] = await client<DbRow[]>`
    INSERT INTO grids.record_scan_codes (base_id, table_id, record_id, code)
    SELECT t.base_id, r.table_id, r.id, ${params.code}
    FROM grids.records r
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE b.id = ${params.baseId}::uuid
      AND t.id = ${params.tableId}::uuid
      AND r.id = ${params.recordId}::uuid
      AND r.deleted_at IS NULL
    ON CONFLICT (record_id) WHERE active = TRUE
    DO UPDATE SET record_id = EXCLUDED.record_id
    RETURNING id, base_id, table_id, record_id, code, active, created_at, rotated_at
  `;
  if (!row) throw err.notFound("record");
  return mapScanCodeRow(row);
};

export const ensureRecordScanCode = async (params: {
  baseId: string;
  tableId: string;
  recordId: string;
  client?: SqlClient;
}): Promise<RecordScanCode> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await getOrCreateRecordScanCode({
        ...params,
        code: `gsc_${crypto.common.generateKey(16)}`,
      });
    } catch (error) {
      if (isUniqueViolation(error, "idx_grids_record_scan_codes_code")) continue;
      throw error;
    }
  }
  throw err.internal("record scan code generation collided repeatedly");
};

export const getRecordScanCode = async (code: string): Promise<RecordScanCode | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, base_id, table_id, record_id, code, active, created_at, rotated_at
    FROM grids.record_scan_codes
    WHERE code = ${code} AND active = TRUE
  `;
  return row ? mapScanCodeRow(row) : null;
};
