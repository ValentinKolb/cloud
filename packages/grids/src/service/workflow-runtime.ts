import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { type DateContext, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { app } from "../config";
import type {
  DocumentRun,
  RecordQuery,
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowTriggerKind,
  WorkflowValue,
} from "../contracts";
import { createWorkflowNotificationSender, type WorkflowNotificationSender } from "../notifications";
import {
  hasInvalidWorkflowMessageExpression,
  parseWorkflowValueString,
  workflowMessageExpressions,
  workflowValueExpression,
} from "../workflows/value-expression";
import { logAudit } from "./audit";
import { canReadDashboardIncludedData } from "./dashboard-included-access";
import { get as getDashboard } from "./dashboards";
import { createDocumentLink, createRunForRecord, type DocumentPdfRenderer, getTemplate, publicDocumentLinkUrl } from "./documents";
import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import type { GridsRecordEvent } from "./record-events";
import { create as createRecord, get as getRecord, list as listRecords, update as updateRecord } from "./records";
import { get as getTable } from "./tables";
import type { GridRecord, Table } from "./types";
import { executeWorkflowEmailAction, type WorkflowEmailAction, WorkflowEmailDeliveryInterruptedError } from "./workflow-email-action";
import { requestWorkflowHttp } from "./workflow-http-client";
import { executeWorkflowSteps, type RuntimeStep } from "./workflow-runtime-executor";
import {
  claimRun,
  createWorkflowRun,
  finishRun,
  get,
  getPersistedWorkflowRun,
  getRecordScanCode,
  heartbeatRun,
  loadWorkflowCatalog,
  type PersistedWorkflowRun,
  resolveWorkflowFieldRef,
  resolveWorkflowTableRef,
  resolveWorkflowTemplateRef,
  restoreWorkflowCatalog,
  type StoredWorkflowAuthorization,
  snapshotWorkflowCatalog,
  type WorkflowCatalog,
  type WorkflowCatalogSnapshot,
} from "./workflows";

type RuntimeRecord = { kind: "record"; tableId: string; recordId: string };
type RuntimeRecordList = { kind: "recordList"; tableId: string; recordIds: string[] };
type RuntimeWorkflowSucceed = { kind: "workflowSucceed"; message: string };
type RuntimeValue = WorkflowValue | RuntimeRecord | RuntimeRecordList | RuntimeWorkflowSucceed | DocumentRun | GridRecord;
type RuntimeCondition = {
  equals?: [WorkflowValue, WorkflowValue];
  notEquals?: [WorkflowValue, WorkflowValue];
  exists?: string;
};
type RuntimeUpdateRecordAction = { record: string; set: Record<string, WorkflowValue> };
type RuntimeCreateRecordAction = { table: string; values: Record<string, WorkflowValue>; saveAs?: string };
type RuntimeGenerateDocumentAction = {
  template: string;
  record: string;
  batch?: boolean;
  filename?: WorkflowValue;
  tags?: WorkflowValue[];
  saveAs?: string;
};
type RuntimeCreateDocumentLinkAction = {
  document: string;
  expiresIn?: "1d" | "7d" | "30d" | "90d";
  comment?: WorkflowValue;
  saveAs?: string;
};
type RuntimeHttpRequestAction = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  json?: WorkflowValue;
  timeoutMs?: number;
  saveAs?: string;
};
type RuntimeSetVariableAction = { name: string; value: WorkflowValue };

type WorkflowRuntimeInput = Record<string, unknown>;

export type ExecuteWorkflowParams = {
  workflowId: string;
  triggerKind: WorkflowTriggerKind;
  actorUserId?: string | null;
  actorGroupIds?: string[];
  serviceAccountId?: string | null;
  triggerInput?: WorkflowRuntimeInput | null;
  resolvedInput?: WorkflowRuntimeInput | null;
  leaseMs?: number;
  heartbeat?: () => Promise<void>;
  notificationSender?: WorkflowNotificationSender;
  documentPdfRenderer?: DocumentPdfRenderer;
};

type WorkflowTriggerAuthorization = StoredWorkflowAuthorization;

type ExecutePreparedWorkflowRunParams = {
  runId: string;
  queueAttempt: number;
  leaseMs?: number;
  heartbeat?: () => Promise<void>;
  notificationSender?: WorkflowNotificationSender;
  documentPdfRenderer?: DocumentPdfRenderer;
};

export type ExecuteScannerWorkflowParams = Omit<ExecuteWorkflowParams, "triggerKind" | "triggerInput" | "resolvedInput"> & {
  scannedText: string;
};

export type ExecuteBulkSelectionWorkflowParams = Omit<ExecuteWorkflowParams, "triggerKind" | "triggerInput" | "resolvedInput"> & {
  inputName?: string;
  recordIds?: string[];
  query?: RecordQuery;
};

type ExecuteRecordEventWorkflowParams = Omit<ExecuteWorkflowParams, "triggerKind" | "triggerInput" | "resolvedInput"> & {
  event: GridsRecordEvent;
};

export type PreparedWorkflowTriggerRun = {
  workflow: Workflow;
  triggerKind: WorkflowTriggerKind;
  triggerInput: WorkflowRuntimeInput | null;
  resolvedInput: WorkflowRuntimeInput;
  actorUserId: string | null;
  actorGroupIds: string[];
  serviceAccountId: string | null;
  authorization: WorkflowTriggerAuthorization;
  workflowCatalog?: WorkflowCatalogSnapshot;
};

type WorkflowRunPrincipal = {
  actorUserId: string | null;
  actorGroupIds: string[];
  serviceAccountId: string | null;
};

const MAX_BULK_RECORDS = 10_000;
const MAX_LOOP_ITEMS = MAX_BULK_RECORDS;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCAN_CODE_PATH_RE = /(?:^|\/)scan(?:\?|$)/;
const defaultWorkflowNotificationSender = createWorkflowNotificationSender(app.notifications);

type RuntimeContext = {
  workflow: Workflow;
  definition: WorkflowDefinition;
  catalog: WorkflowCatalog;
  runId: string | null;
  executionGeneration: number | null;
  actorUserId: string | null;
  actorGroupIds: string[];
  serviceAccountId: string | null;
  input: Map<string, RuntimeValue>;
  variables: Map<string, RuntimeValue>;
  records: Map<string, GridRecord>;
  readableTableIds: Set<string>;
  dateConfig: DateContext;
  leaseMs?: number;
  heartbeat?: () => Promise<void>;
  notificationSender: WorkflowNotificationSender;
  documentPdfRenderer?: DocumentPdfRenderer;
};

const normalizeScannedText = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed, "https://grids.local");
    const code = parsed.searchParams.get("code");
    if (code && SCAN_CODE_PATH_RE.test(parsed.pathname)) return code.trim();
  } catch {
    // Non-URL scanner payloads are expected. Fall back to the raw scanned value.
  }
  return trimmed;
};

const workflowDateConfig = async (): Promise<DateContext> => ({
  timeZone: normalizeTimeZone(String((await settingsGet<string>("app.timezone")) || "").trim(), "UTC"),
  locale: "en",
  firstDayOfWeek: 1,
});

const loadUserGroupIds = async (userId: string | null): Promise<string[]> => {
  if (!userId) return [];
  const rows = await sql<{ id: string }[]>`
    SELECT group_id::text AS id
    FROM auth.user_groups_v2
    WHERE user_id = ${userId}::uuid
    ORDER BY group_id
  `;
  return rows.map((row) => row.id);
};

export const workflowOwnerPrincipal = async (workflow: Pick<Workflow, "ownerUserId">): Promise<WorkflowRunPrincipal> => ({
  actorUserId: workflow.ownerUserId,
  actorGroupIds: await loadUserGroupIds(workflow.ownerUserId),
  serviceAccountId: null,
});

const pathKey = (value: RuntimeRecord): string => `${value.tableId}:${value.recordId}`;

const isRecord = (value: RuntimeValue): value is RuntimeRecord =>
  Boolean(value && typeof value === "object" && (value as { kind?: unknown }).kind === "record");

const isRecordList = (value: RuntimeValue): value is RuntimeRecordList =>
  Boolean(value && typeof value === "object" && (value as { kind?: unknown }).kind === "recordList");

const isGridRecord = (value: RuntimeValue): value is GridRecord =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { id?: unknown }).id === "string" &&
      typeof (value as { tableId?: unknown }).tableId === "string" &&
      typeof (value as { data?: unknown }).data === "object",
  );

const isDocumentRun = (value: RuntimeValue): value is DocumentRun =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { id?: unknown }).id === "string" &&
      typeof (value as { documentNumber?: unknown }).documentNumber === "string" &&
      typeof (value as { filename?: unknown }).filename === "string" &&
      typeof (value as { snapshotId?: unknown }).snapshotId === "string",
  );

const isWorkflowSucceed = (value: RuntimeValue | null): value is RuntimeWorkflowSucceed =>
  Boolean(value && typeof value === "object" && (value as { kind?: unknown }).kind === "workflowSucceed");

const readRecord = async (ctx: RuntimeContext, ref: RuntimeRecord): Promise<Result<GridRecord>> => {
  const permission = await requireTableReadPermission(ctx, ref.tableId);
  if (!permission.ok) return permission;
  const cached = ctx.records.get(pathKey(ref));
  if (cached) return ok(cached);
  const record = await getRecord(ref.tableId, ref.recordId, { includeRelations: true, dateConfig: ctx.dateConfig });
  if (!record) return fail(err.notFound("record"));
  ctx.records.set(pathKey(ref), record);
  return ok(record);
};

const requirePermission = async (
  ctx: RuntimeContext,
  target: { tableId: string; documentTemplateId?: string },
  required: "read" | "write" | "admin",
): Promise<Result<void>> => {
  const grants = await loadGrantsForUser({
    userId: ctx.actorUserId,
    userGroups: ctx.actorGroupIds,
    serviceAccountId: ctx.serviceAccountId,
    baseId: ctx.workflow.baseId,
    tableId: target.tableId,
    documentTemplateId: target.documentTemplateId ?? null,
  });
  const level = resolveEffectivePermission(
    grants,
    target.documentTemplateId
      ? { baseId: ctx.workflow.baseId, tableId: target.tableId, documentTemplateId: target.documentTemplateId }
      : { baseId: ctx.workflow.baseId, tableId: target.tableId },
  );
  return hasAtLeast(level, required) ? ok() : fail(err.forbidden("Workflow actor does not have permission for this action."));
};

const requireWorkflowRunPermission = async (ctx: RuntimeContext): Promise<Result<void>> => {
  const grants = await loadGrantsForUser({
    userId: ctx.actorUserId,
    userGroups: ctx.actorGroupIds,
    serviceAccountId: ctx.serviceAccountId,
    baseId: ctx.workflow.baseId,
    workflowId: ctx.workflow.id,
  });
  return hasAtLeast(resolveEffectivePermission(grants, { baseId: ctx.workflow.baseId, workflowId: ctx.workflow.id }), "write")
    ? ok()
    : fail(err.forbidden("Workflow actor cannot run this workflow."));
};

const requireTableReadPermission = async (ctx: RuntimeContext, tableId: string): Promise<Result<void>> => {
  if (ctx.readableTableIds.has(tableId)) return ok();
  const permission = await requirePermission(ctx, { tableId }, "read");
  if (permission.ok) ctx.readableTableIds.add(tableId);
  return permission;
};

const triggerConfig = (definition: WorkflowDefinition, kind: WorkflowTriggerKind): unknown => {
  switch (kind) {
    case "form":
      return definition.triggers.form;
    case "api":
      return definition.triggers.api;
    case "scanner":
      return definition.triggers.scanner;
    case "bulkSelection":
      return definition.triggers.bulkSelection;
    case "dashboardButton":
      return definition.triggers.dashboardButton;
    case "schedule":
      return definition.triggers.schedule;
    case "recordEvent":
      return definition.triggers.recordEvent;
  }
};

const recordEventName = (event: GridsRecordEvent): "created" | "updated" | "deleted" | null => {
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

const requireDeclaredTrigger = (definition: WorkflowDefinition, kind: WorkflowTriggerKind): Result<void> => {
  const trigger = triggerConfig(definition, kind);
  if (!trigger) return fail(err.badInput(`workflow does not define a ${kind} trigger`));
  if (typeof trigger === "object" && trigger !== null && (trigger as { enabled?: unknown }).enabled === false) {
    return fail(err.badInput(`workflow ${kind} trigger is disabled`));
  }
  return ok();
};

const createRuntimeContext = async (
  params: ExecuteWorkflowParams,
  workflow: Workflow,
  definition: WorkflowDefinition = workflow.compiled,
  catalogSnapshot?: WorkflowCatalogSnapshot,
): Promise<RuntimeContext> => {
  const catalog = catalogSnapshot ? restoreWorkflowCatalog(catalogSnapshot) : await loadWorkflowCatalog(workflow.baseId);
  return {
    workflow,
    definition,
    catalog,
    runId: null,
    executionGeneration: null,
    actorUserId: params.actorUserId ?? null,
    actorGroupIds: params.actorGroupIds ?? [],
    serviceAccountId: params.serviceAccountId ?? null,
    input: new Map(),
    variables: new Map(),
    records: new Map(),
    readableTableIds: new Set(),
    dateConfig: await workflowDateConfig(),
    leaseMs: params.leaseMs,
    heartbeat: params.heartbeat,
    notificationSender: params.notificationSender ?? defaultWorkflowNotificationSender,
    documentPdfRenderer: params.documentPdfRenderer,
  };
};

const requireExecutionAuthorization = async (ctx: RuntimeContext, authorization: WorkflowTriggerAuthorization): Promise<Result<void>> => {
  // Runs keep their accepted principal and definition, but current resource ACLs still govern execution.
  if (authorization.kind === "workflow") return requireWorkflowRunPermission(ctx);
  const dashboard = await getDashboard(authorization.dashboardId);
  if (!dashboard || dashboard.baseId !== ctx.workflow.baseId) return fail(err.forbidden("Workflow dashboard access was revoked."));
  const canRead = await canReadDashboardIncludedData(dashboard, {
    userId: ctx.actorUserId,
    userGroups: ctx.actorGroupIds,
    serviceAccountId: ctx.serviceAccountId,
  });
  if (!canRead) return fail(err.forbidden("Workflow dashboard access was revoked."));
  const widget = dashboard.config.rows.flatMap((row) => row.cells).find((cell) => cell.id === authorization.dashboardWidgetId);
  return widget?.kind === "workflow-button" && widget.workflowId === ctx.workflow.id
    ? ok()
    : fail(err.forbidden("Workflow dashboard button is no longer available."));
};

const plainResolvedInput = (ctx: RuntimeContext): WorkflowRuntimeInput =>
  Object.fromEntries([...ctx.input.entries()].map(([key, value]) => [key, valueToPlain(value)]));

type WorkflowExecutionPreparation = PreparedWorkflowTriggerRun & {
  ctx: RuntimeContext;
};

const prepareWorkflowExecution = async (
  params: ExecuteWorkflowParams,
  authorization: WorkflowTriggerAuthorization = { kind: "workflow" },
  pinnedDefinition?: WorkflowDefinition,
  pinnedCatalog?: WorkflowCatalogSnapshot,
): Promise<Result<WorkflowExecutionPreparation>> => {
  const workflow = await get(params.workflowId);
  if (!workflow) return fail(err.notFound("workflow"));
  if (!workflow.enabled) return fail(err.badInput("workflow is disabled"));
  const definition = pinnedDefinition ?? workflow.compiled;
  const trigger = requireDeclaredTrigger(definition, params.triggerKind);
  if (!trigger.ok) return trigger;
  const ctx = await createRuntimeContext(params, workflow, definition, pinnedCatalog);
  const permission = await requireExecutionAuthorization(ctx, authorization);
  if (!permission.ok) return permission;
  const input = resolveInputs(ctx, params.resolvedInput ?? params.triggerInput ?? {});
  if (!input.ok) return input;
  return ok({
    workflow,
    ctx,
    triggerKind: params.triggerKind,
    triggerInput: params.triggerInput ?? null,
    resolvedInput: plainResolvedInput(ctx),
    actorUserId: ctx.actorUserId,
    actorGroupIds: ctx.actorGroupIds,
    serviceAccountId: ctx.serviceAccountId,
    authorization,
    workflowCatalog: snapshotWorkflowCatalog(ctx.catalog),
  });
};

const resolveInputRecord = (tableId: string, raw: unknown): RuntimeRecord | null => {
  if (typeof raw === "string" && UUID_RE.test(raw)) return { kind: "record", tableId, recordId: raw };
  if (raw && typeof raw === "object") {
    const id = (raw as { id?: unknown; recordId?: unknown }).id ?? (raw as { recordId?: unknown }).recordId;
    if (typeof id === "string" && UUID_RE.test(id)) return { kind: "record", tableId, recordId: id };
  }
  return null;
};

const resolveInputRecordList = (tableId: string, raw: unknown): RuntimeRecordList | null => {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { ids?: unknown }).ids)
      ? (raw as { ids: unknown[] }).ids
      : null;
  if (!values) return null;
  const recordIds = values.filter((value): value is string => typeof value === "string" && UUID_RE.test(value));
  return recordIds.length === values.length ? { kind: "recordList", tableId, recordIds } : null;
};

const isDateInput = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const isDateTimeInput = (value: string): boolean => {
  if (!value.trim()) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
};

const resolveScalarInput = (
  name: string,
  input: NonNullable<WorkflowDefinition["inputs"]>[string],
  raw: unknown,
): Result<WorkflowValue> => {
  if (input.type === "text") return typeof raw === "string" ? ok(raw) : fail(err.badInput(`workflow input "${name}" must be text`));
  if (input.type === "number") {
    return typeof raw === "number" && Number.isFinite(raw) ? ok(raw) : fail(err.badInput(`workflow input "${name}" must be a number`));
  }
  if (input.type === "boolean")
    return typeof raw === "boolean" ? ok(raw) : fail(err.badInput(`workflow input "${name}" must be true or false`));
  if (input.type === "date") {
    return typeof raw === "string" && isDateInput(raw)
      ? ok(raw)
      : fail(err.badInput(`workflow input "${name}" must be a date in YYYY-MM-DD format`));
  }
  if (input.type === "dateTime") {
    return typeof raw === "string" && isDateTimeInput(raw)
      ? ok(raw)
      : fail(err.badInput(`workflow input "${name}" must be an ISO date-time string`));
  }
  if (input.type === "select") {
    return typeof raw === "string" && (input.options ?? []).includes(raw)
      ? ok(raw)
      : fail(err.badInput(`workflow input "${name}" must be one of the configured options`));
  }
  return fail(err.badInput(`workflow input "${name}" has unsupported type "${input.type}"`));
};

const resolveInputs = (ctx: RuntimeContext, rawInput: WorkflowRuntimeInput): Result<void> => {
  for (const [name, input] of Object.entries(ctx.definition.inputs ?? {})) {
    const raw = rawInput[name];
    if (raw === undefined || raw === null) {
      if (input.required) return fail(err.badInput(`workflow input "${name}" is required`));
      ctx.input.set(name, null);
      continue;
    }
    if (input.type === "record" || input.type === "recordList") {
      const table = input.table ? resolveWorkflowTableRef(ctx.catalog, input.table) : null;
      if (!table) return fail(err.badInput(`workflow input "${name}" references an unknown table`));
      const value = input.type === "record" ? resolveInputRecord(table.id, raw) : resolveInputRecordList(table.id, raw);
      if (!value)
        return fail(err.badInput(`workflow input "${name}" must provide ${input.type === "record" ? "a record id" : "record ids"}`));
      ctx.input.set(name, value);
    } else {
      const value = resolveScalarInput(name, input, raw);
      if (!value.ok) return value;
      ctx.input.set(name, value.data);
    }
  }
  return ok();
};

const valueToPlain = (value: RuntimeValue): unknown => {
  if (isRecord(value)) return value.recordId;
  if (isRecordList(value)) return value.recordIds;
  if (isWorkflowSucceed(value)) return { message: value.message };
  return value;
};

const readPathValue = async (ctx: RuntimeContext, root: RuntimeValue, fieldRef: string): Promise<Result<RuntimeValue>> => {
  if (isRecord(root)) {
    const field = resolveWorkflowFieldRef(ctx.catalog, root.tableId, fieldRef);
    if (!field) return fail(err.badInput(`unknown workflow field "${fieldRef}"`));
    const record = await readRecord(ctx, root);
    if (!record.ok) return record;
    return ok((record.data.data[field.id] ?? null) as RuntimeValue);
  }
  let current: unknown = valueToPlain(root);
  for (const segment of fieldRef.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
      return fail(err.badInput(`unknown workflow value path "${fieldRef}"`));
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return ok((current ?? null) as RuntimeValue);
};

const evaluateValue = async (ctx: RuntimeContext, value: WorkflowValue): Promise<Result<RuntimeValue>> => {
  if (typeof value === "string") {
    const parsed = parseWorkflowValueString(value);
    if (parsed.kind === "invalid") return fail(err.badInput(`invalid workflow value expression "${value}"`));
    if (parsed.kind === "literal") return ok(value);
    if (parsed.expression.kind === "now") return ok(new Date().toISOString());
    const [rootName, ...path] = parsed.expression.reference.split(".");
    if (rootName === "inputs") {
      const inputName = path.shift() ?? "";
      const root = ctx.input.get(inputName);
      if (root === undefined) return fail(err.badInput(`workflow value references unknown input "${inputName}"`));
      return path.length > 0 ? readPathValue(ctx, root, path.join(".")) : ok(root);
    }
    const root = ctx.variables.get(rootName ?? "");
    if (root === undefined) return fail(err.badInput(`workflow value references unknown value "${rootName ?? ""}"`));
    return path.length > 0 ? readPathValue(ctx, root, path.join(".")) : ok(root);
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const evaluated = await evaluateValue(ctx, item);
      if (!evaluated.ok) return evaluated;
      out.push(valueToPlain(evaluated.data));
    }
    return ok(out as RuntimeValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const evaluated = await evaluateValue(ctx, item as WorkflowValue);
      if (!evaluated.ok) return evaluated;
      out[key] = valueToPlain(evaluated.data);
    }
    return ok(out);
  }
  return ok(value);
};

const evaluateReference = (ctx: RuntimeContext, reference: string): Promise<Result<RuntimeValue>> =>
  evaluateValue(ctx, workflowValueExpression(reference));

const valuesEqual = (left: RuntimeValue, right: RuntimeValue): boolean =>
  JSON.stringify(valueToPlain(left)) === JSON.stringify(valueToPlain(right));

const stringifyMessageValue = (value: RuntimeValue): string => {
  const plain = valueToPlain(value);
  if (plain === null || plain === undefined) return "";
  if (typeof plain === "string") return plain;
  if (typeof plain === "number" || typeof plain === "boolean") return String(plain);
  return JSON.stringify(plain);
};

const evaluateMessageExpression = async (ctx: RuntimeContext, expression: string): Promise<Result<string>> => {
  const value = await evaluateValue(ctx, `\${{ ${expression} }}`);
  return value.ok ? ok(stringifyMessageValue(value.data)) : value;
};

const renderRuntimeMessage = async (ctx: RuntimeContext, raw: unknown, fallback: string): Promise<Result<string>> => {
  const template = String(raw ?? fallback);
  if (hasInvalidWorkflowMessageExpression(template)) return fail(err.badInput(`invalid workflow message expression in "${template}"`));
  let rendered = "";
  let cursor = 0;
  for (const expression of workflowMessageExpressions(template)) {
    rendered += template.slice(cursor, expression.index);
    if (!expression.expression) return fail(err.badInput(`invalid workflow message expression "${expression.source}"`));
    const evaluated = await evaluateMessageExpression(ctx, expression.source);
    if (!evaluated.ok) return evaluated;
    rendered += evaluated.data;
    cursor = expression.index + expression.raw.length;
  }
  rendered += template.slice(cursor);
  if (rendered.length > 1000) return fail(err.badInput("workflow message renders longer than 1000 characters"));
  return ok(rendered);
};

const stepOutputValue = (value: RuntimeValue | null): unknown => {
  if (value === null) return null;
  if (isRecord(value)) return { kind: "record", tableId: value.tableId, recordId: value.recordId };
  if (isRecordList(value)) return { kind: "recordList", tableId: value.tableId, recordIds: value.recordIds };
  if (isWorkflowSucceed(value)) return value;
  if (isGridRecord(value)) return { kind: "record", tableId: value.tableId, recordId: value.id };
  if (isDocumentRun(value)) return value;
  if (value && typeof value === "object" && "kind" in value) return value;
  return valueToPlain(value);
};

const restoreStepOutputValue = (value: unknown): RuntimeValue | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value as WorkflowValue;
  const item = value as Record<string, unknown>;
  if (item.kind === "record" && typeof item.tableId === "string" && typeof item.recordId === "string") {
    return { kind: "record", tableId: item.tableId, recordId: item.recordId };
  }
  if (item.kind === "recordList" && typeof item.tableId === "string" && Array.isArray(item.recordIds)) {
    const recordIds = item.recordIds.filter((recordId): recordId is string => typeof recordId === "string");
    return recordIds.length === item.recordIds.length ? { kind: "recordList", tableId: item.tableId, recordIds } : null;
  }
  if (item.kind === "workflowSucceed" && typeof item.message === "string") {
    return { kind: "workflowSucceed", message: item.message };
  }
  if (
    typeof item.id === "string" &&
    typeof item.documentNumber === "string" &&
    typeof item.filename === "string" &&
    typeof item.snapshotId === "string"
  ) {
    return item as DocumentRun;
  }
  return item as WorkflowValue;
};

const saveRestoredStepOutput = (ctx: RuntimeContext, item: RuntimeStep, value: RuntimeValue | null): void => {
  if ("setVariable" in item) {
    const action = item.setVariable as RuntimeSetVariableAction;
    if (value !== null) ctx.variables.set(action.name, value);
    return;
  }
  if ("createRecord" in item) {
    const action = item.createRecord as RuntimeCreateRecordAction;
    if (action.saveAs && value !== null) ctx.variables.set(action.saveAs, value);
    return;
  }
  if ("generateDocument" in item) {
    const action = item.generateDocument as RuntimeGenerateDocumentAction;
    if (action.saveAs && value !== null) ctx.variables.set(action.saveAs, value);
    return;
  }
  if ("createDocumentLink" in item) {
    const action = item.createDocumentLink as RuntimeCreateDocumentLinkAction;
    if (action.saveAs && value !== null) ctx.variables.set(action.saveAs, value);
    return;
  }
  if ("sendEmail" in item) {
    const action = item.sendEmail as WorkflowEmailAction;
    if (action.saveAs && value !== null) ctx.variables.set(action.saveAs, value);
    return;
  }
  if ("httpRequest" in item) {
    const action = item.httpRequest as RuntimeHttpRequestAction;
    if (action.saveAs && value !== null) ctx.variables.set(action.saveAs, value);
  }
};

const restoreSucceededStep = (ctx: RuntimeContext, item: RuntimeStep, stepRun: WorkflowStepRun): Result<RuntimeValue | null> => {
  const output = stepRun.output;
  if (!output || output.ok !== true || !("value" in output)) {
    return fail(err.internal(`workflow step "${stepRun.stepPath}" cannot be resumed because its output is missing`));
  }
  const value = restoreStepOutputValue(output.value);
  saveRestoredStepOutput(ctx, item, value);
  return ok(value);
};

const isSideEffectStep = (item: RuntimeStep): boolean =>
  "updateRecord" in item ||
  "createRecord" in item ||
  "generateDocument" in item ||
  "createDocumentLink" in item ||
  "sendEmail" in item ||
  "httpRequest" in item;

const isRetryableSideEffectStep = (item: RuntimeStep): boolean => "sendEmail" in item;

const evaluateCondition = async (ctx: RuntimeContext, condition: RuntimeCondition): Promise<Result<boolean>> => {
  if (condition.equals) {
    const left = await evaluateValue(ctx, condition.equals[0]);
    if (!left.ok) return left;
    const right = await evaluateValue(ctx, condition.equals[1]);
    if (!right.ok) return right;
    return ok(valuesEqual(left.data, right.data));
  }
  if (condition.notEquals) {
    const left = await evaluateValue(ctx, condition.notEquals[0]);
    if (!left.ok) return left;
    const right = await evaluateValue(ctx, condition.notEquals[1]);
    if (!right.ok) return right;
    return ok(!valuesEqual(left.data, right.data));
  }
  if (condition.exists) {
    const value = await evaluateReference(ctx, condition.exists);
    return value.ok ? ok(value.data !== null && value.data !== undefined && value.data !== "") : value;
  }
  return fail(err.badInput("workflow condition has no operator"));
};

const resolvePayload = async (
  ctx: RuntimeContext,
  tableId: string,
  values: Record<string, WorkflowValue>,
): Promise<Result<Record<string, unknown>>> => {
  const payload: Record<string, unknown> = {};
  for (const [fieldRef, raw] of Object.entries(values)) {
    const field = resolveWorkflowFieldRef(ctx.catalog, tableId, fieldRef);
    if (!field) return fail(err.badInput(`unknown workflow field "${fieldRef}"`));
    const evaluated = await evaluateValue(ctx, raw);
    if (!evaluated.ok) return evaluated;
    payload[field.id] = valueToPlain(evaluated.data);
  }
  return ok(payload);
};

const workflowAuditMeta = (ctx: RuntimeContext) => ({
  workflowId: ctx.workflow.id,
  workflowRunId: ctx.runId,
  serviceAccountId: ctx.serviceAccountId,
});

const executeUpdateRecord = async (ctx: RuntimeContext, action: RuntimeUpdateRecordAction): Promise<Result<RuntimeValue>> => {
  const recordValue = await evaluateReference(ctx, action.record);
  if (!recordValue.ok) return recordValue;
  if (!isRecord(recordValue.data)) return fail(err.badInput("updateRecord.record must resolve to a record"));
  const permission = await requirePermission(ctx, { tableId: recordValue.data.tableId }, "write");
  if (!permission.ok) return permission;
  const payload = await resolvePayload(ctx, recordValue.data.tableId, action.set);
  if (!payload.ok) return payload;
  const updated = await updateRecord(recordValue.data.tableId, recordValue.data.recordId, payload.data, ctx.actorUserId, undefined, {
    dateConfig: ctx.dateConfig,
  });
  if (!updated.ok) return updated;
  ctx.records.set(pathKey(recordValue.data), updated.data);
  await logAudit({
    baseId: ctx.workflow.baseId,
    tableId: recordValue.data.tableId,
    recordId: recordValue.data.recordId,
    userId: ctx.actorUserId,
    action: "workflow.record.updated",
    diff: {
      workflowRecordUpdate: {
        old: null,
        new: {
          ...workflowAuditMeta(ctx),
          tableId: recordValue.data.tableId,
          recordId: recordValue.data.recordId,
          fields: Object.keys(action.set),
        },
      },
    },
  });
  return ok(updated.data);
};

const executeCreateRecord = async (ctx: RuntimeContext, action: RuntimeCreateRecordAction): Promise<Result<RuntimeValue>> => {
  const table = resolveWorkflowTableRef(ctx.catalog, action.table);
  if (!table) return fail(err.badInput(`unknown workflow table "${action.table}"`));
  const permission = await requirePermission(ctx, { tableId: table.id }, "write");
  if (!permission.ok) return permission;
  const payload = await resolvePayload(ctx, table.id, action.values);
  if (!payload.ok) return payload;
  const created = await createRecord(table.id, payload.data, ctx.actorUserId, { dateConfig: ctx.dateConfig });
  if (!created.ok) return created;
  const ref: RuntimeRecord = { kind: "record", tableId: table.id, recordId: created.data.id };
  ctx.records.set(pathKey(ref), created.data);
  if (action.saveAs) ctx.variables.set(action.saveAs, ref);
  await logAudit({
    baseId: ctx.workflow.baseId,
    tableId: table.id,
    recordId: created.data.id,
    userId: ctx.actorUserId,
    action: "workflow.record.created",
    diff: {
      workflowRecordCreate: {
        old: null,
        new: {
          ...workflowAuditMeta(ctx),
          tableId: table.id,
          recordId: created.data.id,
          fields: Object.keys(action.values),
        },
      },
    },
  });
  return ok(created.data);
};

const executeGenerateDocument = async (ctx: RuntimeContext, action: RuntimeGenerateDocumentAction): Promise<Result<RuntimeValue>> => {
  const templateRef = resolveWorkflowTemplateRef(ctx.catalog, action.template);
  if (!templateRef) return fail(err.badInput(`unknown workflow document template "${action.template}"`));
  const recordValue = await evaluateReference(ctx, action.record);
  if (!recordValue.ok) return recordValue;
  if (!isRecord(recordValue.data)) return fail(err.badInput("generateDocument.record must resolve to a record"));
  const permission = await requirePermission(ctx, { tableId: templateRef.tableId, documentTemplateId: templateRef.id }, "write");
  if (!permission.ok) return permission;
  const template = await getTemplate(templateRef.id);
  if (!template) return fail(err.notFound("document template"));
  const table = await getTable(templateRef.tableId);
  if (!table) return fail(err.notFound("table"));
  const filename = action.filename === undefined ? null : await evaluateValue(ctx, action.filename);
  if (filename && !filename.ok) return filename;
  const tags: string[] = [];
  for (const item of action.tags ?? []) {
    const evaluated = await evaluateValue(ctx, item);
    if (!evaluated.ok) return evaluated;
    if (typeof evaluated.data === "string" && evaluated.data.trim()) tags.push(evaluated.data.trim());
  }
  const run = await createRunForRecord({
    template,
    table: table as Table,
    recordId: recordValue.data.recordId,
    actorId: ctx.actorUserId,
    canReadRelatedTable: async ({ tableId }) => (await requireTableReadPermission(ctx, tableId)).ok,
    dateConfig: ctx.dateConfig,
    filename: filename && typeof filename.data === "string" ? filename.data : null,
    tags,
    workflowRunId: ctx.runId,
    renderPdf: ctx.documentPdfRenderer,
  });
  if (!run.ok) return run;
  if (action.saveAs) ctx.variables.set(action.saveAs, run.data);
  await logAudit({
    baseId: ctx.workflow.baseId,
    tableId: run.data.tableId,
    recordId: run.data.recordId,
    userId: ctx.actorUserId,
    action: "workflow.document.generated",
    diff: {
      workflowDocumentGenerate: {
        old: null,
        new: {
          ...workflowAuditMeta(ctx),
          templateId: template.id,
          documentRunId: run.data.id,
          documentNumber: run.data.documentNumber,
          filename: run.data.filename,
        },
      },
    },
  });
  return ok(run.data);
};

const executeCreateDocumentLink = async (ctx: RuntimeContext, action: RuntimeCreateDocumentLinkAction): Promise<Result<RuntimeValue>> => {
  const documentValue = await evaluateReference(ctx, action.document);
  if (!documentValue.ok) return documentValue;
  if (!isDocumentRun(documentValue.data)) return fail(err.badInput("createDocumentLink.document must resolve to a generated document"));
  const run = documentValue.data;
  const permission = await requirePermission(
    ctx,
    { tableId: run.tableId, ...(run.templateId ? { documentTemplateId: run.templateId } : {}) },
    "write",
  );
  if (!permission.ok) return permission;
  const comment = action.comment === undefined ? null : await evaluateValue(ctx, action.comment);
  if (comment && !comment.ok) return comment;
  const created = await createDocumentLink({
    run,
    input: {
      expiresIn: action.expiresIn ?? "30d",
      comment: comment && typeof comment.data === "string" ? comment.data : null,
    },
    actorId: ctx.actorUserId,
  });
  if (!created.ok) return created;
  const output = {
    kind: "documentLink",
    id: created.data.link.id,
    documentRunId: run.id,
    url: await publicDocumentLinkUrl(created.data.token),
    expiresAt: created.data.link.expiresAt,
  };
  if (action.saveAs) ctx.variables.set(action.saveAs, output);
  await logAudit({
    baseId: ctx.workflow.baseId,
    tableId: run.tableId,
    recordId: run.recordId,
    userId: ctx.actorUserId,
    action: "workflow.document_link.created",
    diff: {
      workflowDocumentLinkCreate: {
        old: null,
        new: {
          ...workflowAuditMeta(ctx),
          documentRunId: run.id,
          documentLinkId: created.data.link.id,
          expiresAt: created.data.link.expiresAt,
        },
      },
    },
  });
  return ok(output);
};

const executeSendEmail = (ctx: RuntimeContext, action: WorkflowEmailAction, stepRun: WorkflowStepRun): Promise<Result<WorkflowValue>> =>
  executeWorkflowEmailAction(
    {
      workflow: ctx.workflow,
      catalog: ctx.catalog,
      runId: ctx.runId,
      stepRunId: stepRun.id,
      actorUserId: ctx.actorUserId,
      serviceAccountId: ctx.serviceAccountId,
      notificationSender: ctx.notificationSender,
      evaluate: (value) => evaluateValue(ctx, value),
      toPlain: valueToPlain,
      saveVariable: (name, value) => ctx.variables.set(name, value),
    },
    action,
  );

const executeHttpRequest = async (
  ctx: RuntimeContext,
  action: RuntimeHttpRequestAction,
  stepRun: WorkflowStepRun,
): Promise<Result<RuntimeValue>> => {
  const payload = action.json === undefined ? undefined : await evaluateValue(ctx, action.json);
  if (payload && !payload.ok) return payload;
  const started = Date.now();
  const host = new URL(action.url).host;
  const idempotencyKey = `workflow:${ctx.runId}:step:${stepRun.id}`;
  const response = await requestWorkflowHttp({
    url: action.url,
    method: action.method,
    headers: action.headers,
    idempotencyKey,
    body: payload ? JSON.stringify(valueToPlain(payload.data)) : undefined,
    timeoutMs: action.timeoutMs,
  });
  if (!response.ok) {
    await logAudit({
      baseId: ctx.workflow.baseId,
      userId: ctx.actorUserId,
      action: "workflow.http.failed",
      diff: {
        httpRequest: {
          old: null,
          new: {
            ...workflowAuditMeta(ctx),
            method: action.method,
            host,
            durationMs: Date.now() - started,
            error: response.error.message,
          },
        },
      },
    });
    return response;
  }
  const output = { status: response.data.status, ok: response.data.ok, body: response.data.body };
  await logAudit({
    baseId: ctx.workflow.baseId,
    userId: ctx.actorUserId,
    action: response.data.ok ? "workflow.http.sent" : "workflow.http.failed",
    diff: {
      httpRequest: {
        old: null,
        new: {
          ...workflowAuditMeta(ctx),
          method: action.method,
          host: response.data.host,
          status: response.data.status,
          durationMs: Date.now() - started,
        },
      },
    },
  });
  if (action.saveAs) ctx.variables.set(action.saveAs, output);
  return response.data.ok ? ok(output) : fail(err.badInput(`httpRequest returned HTTP ${response.data.status}`));
};

const heartbeatWorkflow = async (ctx: RuntimeContext): Promise<void> => {
  if (!ctx.runId || ctx.executionGeneration === null) return;
  if (!(await heartbeatRun(ctx.runId, ctx.executionGeneration, ctx.leaseMs))) throw err.conflict("workflow run lease lost");
  await ctx.heartbeat?.();
};

const withVariableScope = async <T>(ctx: RuntimeContext, run: () => Promise<T>): Promise<T> => {
  const previous = new Map(ctx.variables);
  try {
    return await run();
  } finally {
    ctx.variables.clear();
    for (const [name, value] of previous) ctx.variables.set(name, value);
  }
};

const executeActionStep = async (
  ctx: RuntimeContext,
  item: RuntimeStep,
  stepRun: WorkflowStepRun,
): Promise<Result<RuntimeValue | null> | null> => {
  if ("updateRecord" in item) return executeUpdateRecord(ctx, item.updateRecord as RuntimeUpdateRecordAction);
  if ("createRecord" in item) return executeCreateRecord(ctx, item.createRecord as RuntimeCreateRecordAction);
  if ("generateDocument" in item) return executeGenerateDocument(ctx, item.generateDocument as RuntimeGenerateDocumentAction);
  if ("createDocumentLink" in item) return executeCreateDocumentLink(ctx, item.createDocumentLink as RuntimeCreateDocumentLinkAction);
  if ("sendEmail" in item) return executeSendEmail(ctx, item.sendEmail as WorkflowEmailAction, stepRun);
  if ("httpRequest" in item) return executeHttpRequest(ctx, item.httpRequest as RuntimeHttpRequestAction, stepRun);
  if ("setVariable" in item) {
    const action = item.setVariable as RuntimeSetVariableAction;
    const evaluated = await evaluateValue(ctx, action.value);
    if (evaluated.ok) ctx.variables.set(action.name, evaluated.data);
    return evaluated;
  }
  if ("fail" in item) {
    const message = await renderRuntimeMessage(ctx, (item.fail as { message?: unknown }).message, "workflow failed");
    return message.ok ? fail(err.badInput(message.data)) : message;
  }
  if ("succeed" in item) {
    const message = await renderRuntimeMessage(ctx, (item.succeed as { message?: unknown }).message, "workflow succeeded");
    return message.ok ? ok({ kind: "workflowSucceed", message: message.data }) : message;
  }
  return null;
};

const executeSteps = (ctx: RuntimeContext, runId: string): Promise<Result<RuntimeValue | null>> => {
  if (ctx.executionGeneration === null) return Promise.resolve(fail(err.internal("workflow run was not claimed")));
  return executeWorkflowSteps<RuntimeValue>(
    {
      executeAction: (item, stepRun) => executeActionStep(ctx, item, stepRun),
      evaluateCondition: (condition) => evaluateCondition(ctx, condition as RuntimeCondition),
      evaluateReference: (reference) => evaluateReference(ctx, reference),
      evaluateValue: (value) => evaluateValue(ctx, value),
      heartbeat: () => heartbeatWorkflow(ctx),
      isRecordList,
      isRetryableSideEffectStep,
      isSideEffectStep,
      isWorkflowSucceed,
      maxLoopItems: MAX_LOOP_ITEMS,
      restoreSucceededStep: (item, stepRun) => restoreSucceededStep(ctx, item, stepRun),
      setLoopRecord: (alias, tableId, recordId) => ctx.variables.set(alias, { kind: "record", tableId, recordId }),
      stepOutputValue,
      valuesEqual,
      withVariableScope: (run) => withVariableScope(ctx, run),
    },
    ctx.definition.steps,
    runId,
    ctx.executionGeneration,
    "steps",
  );
};

const isTerminalRun = (run: WorkflowRun): boolean => run.status === "succeeded" || run.status === "failed" || run.status === "canceled";

const executeWorkflowRun = async (
  params: ExecuteWorkflowParams & { queueAttempt?: number },
  persistedRun: PersistedWorkflowRun | null = null,
): Promise<Result<WorkflowRun>> => {
  let claimedPreparedRun: { run: WorkflowRun; claimed: true; executionGeneration: number } | null = null;
  if (persistedRun) {
    if (isTerminalRun(persistedRun)) return ok(persistedRun);
    if (persistedRun.status !== "queued" && persistedRun.status !== "running") return ok(persistedRun);
    const claimed = await claimRun(persistedRun.id, params.leaseMs, params.queueAttempt);
    if (!claimed.claimed || claimed.run.status !== "running" || claimed.executionGeneration === null) return ok(claimed.run);
    claimedPreparedRun = { run: claimed.run, claimed: true, executionGeneration: claimed.executionGeneration };
  }
  const authorization = persistedRun?.authorization ?? { kind: "workflow" };
  const prepared = await prepareWorkflowExecution(params, authorization, persistedRun?.workflowDefinition, persistedRun?.workflowCatalog);
  if (!prepared.ok) {
    if (claimedPreparedRun) {
      await finishRun(claimedPreparedRun.run.id, claimedPreparedRun.executionGeneration, {
        status: "failed",
        error: prepared.error.message,
      });
    }
    return prepared;
  }
  const { workflow, ctx } = prepared.data;

  const run =
    claimedPreparedRun?.run ??
    (await createWorkflowRun({
      workflowId: workflow.id,
      baseId: workflow.baseId,
      workflowDefinition: ctx.definition,
      workflowCatalog: snapshotWorkflowCatalog(ctx.catalog),
      triggerKind: params.triggerKind,
      triggerInput: params.triggerInput ?? null,
      resolvedInput: prepared.data.resolvedInput,
      actorUserId: ctx.actorUserId,
      actorGroupIds: ctx.actorGroupIds,
      serviceAccountId: ctx.serviceAccountId,
      authorization,
    }));
  const claimed = claimedPreparedRun ?? (await claimRun(run.id, params.leaseMs));
  if (!claimed.claimed || claimed.run.status !== "running" || claimed.executionGeneration === null) {
    return ok(claimed.run);
  }
  const started = claimed.run;
  ctx.runId = started.id;
  ctx.executionGeneration = claimed.executionGeneration;
  await heartbeatWorkflow(ctx);
  try {
    const result = await executeSteps(ctx, started.id);
    const finished = await finishRun(started.id, ctx.executionGeneration, {
      status: result.ok ? "succeeded" : "failed",
      error: result.ok ? null : result.error.message,
      resultMessage: result.ok && isWorkflowSucceed(result.data) ? result.data.message : null,
    });
    if (!finished) return fail(err.conflict("workflow run lease lost"));
    return result.ok ? ok(finished) : fail(result.error);
  } catch (error) {
    if (error instanceof WorkflowEmailDeliveryInterruptedError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const finished = await finishRun(started.id, ctx.executionGeneration, { status: "failed", error: message });
    if (!finished) return fail(err.conflict("workflow run lease lost"));
    return fail(err.internal(message));
  }
};

const execute = async (params: ExecuteWorkflowParams): Promise<Result<WorkflowRun>> => executeWorkflowRun(params);

export const prepareWorkflowTriggerRun = async (params: ExecuteWorkflowParams): Promise<Result<PreparedWorkflowTriggerRun>> => {
  const prepared = await prepareWorkflowExecution(params);
  if (!prepared.ok) return prepared;
  return ok({
    workflow: prepared.data.workflow,
    triggerKind: prepared.data.triggerKind,
    triggerInput: prepared.data.triggerInput,
    resolvedInput: prepared.data.resolvedInput,
    actorUserId: prepared.data.actorUserId,
    actorGroupIds: prepared.data.actorGroupIds,
    serviceAccountId: prepared.data.serviceAccountId,
    authorization: prepared.data.authorization,
    workflowCatalog: prepared.data.workflowCatalog,
  });
};

export const prepareDashboardWorkflowTriggerRun = async (
  params: ExecuteWorkflowParams & { triggerKind: "dashboardButton"; dashboardId: string; dashboardWidgetId: string },
): Promise<Result<PreparedWorkflowTriggerRun>> => {
  const authorization: WorkflowTriggerAuthorization = {
    kind: "dashboard-widget",
    dashboardId: params.dashboardId,
    dashboardWidgetId: params.dashboardWidgetId,
  };
  const prepared = await prepareWorkflowExecution(params, authorization);
  if (!prepared.ok) return prepared;
  return ok({
    workflow: prepared.data.workflow,
    triggerKind: prepared.data.triggerKind,
    triggerInput: prepared.data.triggerInput,
    resolvedInput: prepared.data.resolvedInput,
    actorUserId: prepared.data.actorUserId,
    actorGroupIds: prepared.data.actorGroupIds,
    serviceAccountId: prepared.data.serviceAccountId,
    authorization,
    workflowCatalog: prepared.data.workflowCatalog,
  });
};

export const executePreparedRun = async (params: ExecutePreparedWorkflowRunParams): Promise<Result<WorkflowRun>> => {
  const run = await getPersistedWorkflowRun(params.runId);
  if (!run) return fail(err.notFound("workflow run"));
  if (isTerminalRun(run)) return ok(run);
  if (!run.workflowId) {
    const claimed = await claimRun(run.id, params.leaseMs, params.queueAttempt);
    if (!claimed.claimed || claimed.executionGeneration === null) return ok(claimed.run);
    const failure = err.badInput("workflow run no longer references a workflow");
    await finishRun(run.id, claimed.executionGeneration, { status: "failed", error: failure.message });
    return fail(failure);
  }
  return executeWorkflowRun(
    {
      workflowId: run.workflowId,
      triggerKind: run.triggerKind,
      actorUserId: run.actorUserId,
      actorGroupIds: run.actorUserId ? await loadUserGroupIds(run.actorUserId) : [],
      serviceAccountId: run.serviceAccountId,
      triggerInput: run.triggerInput,
      resolvedInput: run.resolvedInput,
      queueAttempt: params.queueAttempt,
      leaseMs: params.leaseMs,
      heartbeat: params.heartbeat,
      notificationSender: params.notificationSender,
      documentPdfRenderer: params.documentPdfRenderer,
    },
    run,
  );
};

const scannerWorkflowContext = async (
  params: ExecuteScannerWorkflowParams,
): Promise<Result<RuntimeContext & { inputName: string; tableId: string }>> => {
  const workflow = await get(params.workflowId);
  if (!workflow) return fail(err.notFound("workflow"));
  if (!workflow.enabled) return fail(err.badInput("workflow is disabled"));
  const scanner = workflow.compiled.triggers.scanner;
  if (!scanner) return fail(err.badInput("workflow does not define a scanner trigger"));
  const input = workflow.compiled.inputs?.[scanner.input];
  if (!input || input.type !== "record" || !input.table) return fail(err.badInput("scanner trigger input must be a record input"));
  const catalog = await loadWorkflowCatalog(workflow.baseId);
  const table = resolveWorkflowTableRef(catalog, input.table);
  if (!table) return fail(err.badInput(`unknown workflow table "${input.table}"`));
  const ctx: RuntimeContext = {
    workflow,
    definition: workflow.compiled,
    catalog,
    runId: null,
    executionGeneration: null,
    actorUserId: params.actorUserId ?? null,
    actorGroupIds: params.actorGroupIds ?? [],
    serviceAccountId: params.serviceAccountId ?? null,
    input: new Map(),
    variables: new Map(),
    records: new Map(),
    readableTableIds: new Set(),
    dateConfig: await workflowDateConfig(),
    leaseMs: params.leaseMs,
    heartbeat: params.heartbeat,
    notificationSender: params.notificationSender ?? defaultWorkflowNotificationSender,
    documentPdfRenderer: params.documentPdfRenderer,
  };
  return ok({ ...ctx, inputName: scanner.input, tableId: table.id });
};

const resolveScannerCode = async (ctx: RuntimeContext, tableId: string, scannedText: string): Promise<Result<string>> => {
  const scan = await getRecordScanCode(scannedText);
  if (!scan || scan.baseId !== ctx.workflow.baseId || scan.tableId !== tableId) return fail(err.notFound("scan code"));
  return ok(scan.recordId);
};

const resolveScannerField = async (
  ctx: RuntimeContext,
  tableId: string,
  fieldRef: string,
  scannedText: string,
): Promise<Result<string>> => {
  const field = resolveWorkflowFieldRef(ctx.catalog, tableId, fieldRef);
  if (!field) return fail(err.badInput(`unknown workflow field "${fieldRef}"`));
  const rows = await sql<{ id: string }[]>`
    SELECT r.id::text AS id
    FROM grids.records r
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE b.id = ${ctx.workflow.baseId}::uuid
      AND r.table_id = ${tableId}::uuid
      AND r.deleted_at IS NULL
      AND r.data ->> ${field.id} = ${scannedText}
    ORDER BY r.id
    LIMIT 2
  `;
  if (rows.length === 0) return fail(err.notFound("scanned record"));
  if (rows.length > 1) return fail(err.badInput(`scanner field "${fieldRef}" matched more than one record`));
  return ok(rows[0]!.id);
};

const bulkWorkflowContext = async (
  params: ExecuteBulkSelectionWorkflowParams,
): Promise<Result<RuntimeContext & { inputName: string; tableId: string }>> => {
  const workflow = await get(params.workflowId);
  if (!workflow) return fail(err.notFound("workflow"));
  if (!workflow.enabled) return fail(err.badInput("workflow is disabled"));
  const bulk = workflow.compiled.triggers.bulkSelection;
  if (!bulk) return fail(err.badInput("workflow does not define a bulkSelection trigger"));
  const inputName = params.inputName ?? bulk.input;
  if (inputName !== bulk.input) return fail(err.badInput(`bulkSelection trigger only accepts input "${bulk.input}"`));
  const input = workflow.compiled.inputs?.[inputName];
  if (!input || input.type !== "recordList" || !input.table)
    return fail(err.badInput("bulkSelection trigger input must be a recordList input"));
  const catalog = await loadWorkflowCatalog(workflow.baseId);
  const table = resolveWorkflowTableRef(catalog, input.table);
  if (!table) return fail(err.badInput(`unknown workflow table "${input.table}"`));
  const ctx: RuntimeContext = {
    workflow,
    definition: workflow.compiled,
    catalog,
    runId: null,
    executionGeneration: null,
    actorUserId: params.actorUserId ?? null,
    actorGroupIds: params.actorGroupIds ?? [],
    serviceAccountId: params.serviceAccountId ?? null,
    input: new Map(),
    variables: new Map(),
    records: new Map(),
    readableTableIds: new Set(),
    dateConfig: await workflowDateConfig(),
    notificationSender: params.notificationSender ?? defaultWorkflowNotificationSender,
    documentPdfRenderer: params.documentPdfRenderer,
  };
  return ok({ ...ctx, inputName, tableId: table.id });
};

const resolveExplicitBulkRecordIds = async (ctx: RuntimeContext, tableId: string, recordIds: string[]): Promise<Result<string[]>> => {
  const uniqueIds = [...new Set(recordIds)];
  if (uniqueIds.length === 0) return fail(err.badInput("bulk selection is empty"));
  if (uniqueIds.length > MAX_BULK_RECORDS) return fail(err.badInput(`bulk selection supports at most ${MAX_BULK_RECORDS} records`));
  if (uniqueIds.length !== recordIds.length || uniqueIds.some((id) => !UUID_RE.test(id)))
    return fail(err.badInput("bulk selection record ids must be unique UUIDs"));
  const rows = await sql<{ id: string }[]>`
    SELECT r.id::text AS id
    FROM grids.records r
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE b.id = ${ctx.workflow.baseId}::uuid
      AND r.table_id = ${tableId}::uuid
      AND r.id = ANY(${sql.array(uniqueIds, "UUID")})
      AND r.deleted_at IS NULL
  `;
  const found = new Set(rows.map((row) => row.id));
  if (found.size !== uniqueIds.length) return fail(err.notFound("bulk selection record"));
  return ok(uniqueIds);
};

const resolveBulkQueryRecordIds = async (ctx: RuntimeContext, tableId: string, query: RecordQuery): Promise<Result<string[]>> => {
  if ((query.groupBy?.length ?? 0) > 0 || (query.aggregations?.length ?? 0) > 0) {
    return fail(err.badInput("bulk selection queries must be row-shaped; grouped and aggregate queries are not supported"));
  }
  const cap = Math.min(query.limit ?? MAX_BULK_RECORDS, MAX_BULK_RECORDS);
  const ids: string[] = [];
  let cursor: string | null = null;
  while (ids.length < cap) {
    const page = await listRecords({
      tableId,
      cursor,
      limit: Math.min(500, cap - ids.length),
      includeDeleted: query.includeDeleted,
      deletedOnly: query.deletedOnly,
      filter: query.filter ?? null,
      search: query.search ?? null,
      recordMeta: query.recordMeta ?? null,
      sort: query.sort ?? [],
      viewer: { userId: ctx.actorUserId, userGroups: ctx.actorGroupIds, serviceAccountId: ctx.serviceAccountId },
      dateConfig: ctx.dateConfig,
    });
    if (!page.ok) return page;
    ids.push(...page.data.items.map((record) => record.id));
    if (!page.data.nextCursor || page.data.items.length === 0) break;
    cursor = page.data.nextCursor;
  }
  return ids.length > 0 ? ok(ids) : fail(err.badInput("bulk selection query returned no records"));
};

export const executeScanner = async (params: ExecuteScannerWorkflowParams): Promise<Result<WorkflowRun>> => {
  const prepared = await prepareScanner(params);
  if (!prepared.ok) return prepared;
  return execute({
    ...params,
    triggerKind: "scanner",
    triggerInput: prepared.data.triggerInput,
    resolvedInput: prepared.data.resolvedInput,
  });
};

const prepareScannerWithAuthorization = async (
  params: ExecuteScannerWorkflowParams,
  authorization: WorkflowTriggerAuthorization,
): Promise<Result<PreparedWorkflowTriggerRun>> => {
  const prepared = await scannerWorkflowContext(params);
  if (!prepared.ok) return prepared;
  const { inputName, tableId, ...ctx } = prepared.data;
  const runPermission = await requireExecutionAuthorization(ctx, authorization);
  if (!runPermission.ok) return runPermission;
  const readPermission = await requireTableReadPermission(ctx, tableId);
  if (!readPermission.ok) return readPermission;
  const scanner = ctx.definition.triggers.scanner!;
  const scannedText = normalizeScannedText(params.scannedText);
  if (!scannedText) return fail(err.badInput("scanner input is empty"));
  const recordId =
    scanner.resolve?.by === "field"
      ? await resolveScannerField(ctx, tableId, scanner.resolve.field ?? "", scannedText)
      : await resolveScannerCode(ctx, tableId, scannedText);
  if (!recordId.ok) return recordId;
  return ok({
    workflow: ctx.workflow,
    triggerKind: "scanner",
    triggerInput: { scan: scannedText },
    resolvedInput: { [inputName]: recordId.data },
    actorUserId: ctx.actorUserId,
    actorGroupIds: ctx.actorGroupIds,
    serviceAccountId: ctx.serviceAccountId,
    authorization,
    workflowCatalog: snapshotWorkflowCatalog(ctx.catalog),
  });
};

export const prepareScanner = async (params: ExecuteScannerWorkflowParams): Promise<Result<PreparedWorkflowTriggerRun>> =>
  prepareScannerWithAuthorization(params, { kind: "workflow" });

export const prepareDashboardScanner = async (
  params: ExecuteScannerWorkflowParams & { dashboardId: string; dashboardWidgetId: string },
): Promise<Result<PreparedWorkflowTriggerRun>> =>
  prepareScannerWithAuthorization(params, {
    kind: "dashboard-widget",
    dashboardId: params.dashboardId,
    dashboardWidgetId: params.dashboardWidgetId,
  });

type PreparedBulkSelectionWorkflowRun = {
  workflow: Workflow;
  workflowCatalog: WorkflowCatalogSnapshot;
  triggerInput: WorkflowRuntimeInput;
  resolvedInput: WorkflowRuntimeInput;
  actorUserId: string | null;
  actorGroupIds: string[];
  serviceAccountId: string | null;
};

export const prepareBulkSelection = async (
  params: ExecuteBulkSelectionWorkflowParams,
): Promise<Result<PreparedBulkSelectionWorkflowRun>> => {
  const prepared = await bulkWorkflowContext(params);
  if (!prepared.ok) return prepared;
  const { inputName, tableId, ...ctx } = prepared.data;
  const runPermission = await requireWorkflowRunPermission(ctx);
  if (!runPermission.ok) return runPermission;
  const readPermission = await requireTableReadPermission(ctx, tableId);
  if (!readPermission.ok) return readPermission;
  const hasIds = params.recordIds !== undefined;
  const hasQuery = params.query !== undefined;
  if (hasIds === hasQuery) return fail(err.badInput("bulk selection requires either recordIds or query"));
  const recordIds = hasIds
    ? await resolveExplicitBulkRecordIds(ctx, tableId, params.recordIds ?? [])
    : await resolveBulkQueryRecordIds(ctx, tableId, params.query ?? {});
  if (!recordIds.ok) return recordIds;
  const triggerInput = hasIds ? { input: inputName, recordIds: params.recordIds } : { input: inputName, query: params.query };
  return ok({
    workflow: ctx.workflow,
    workflowCatalog: snapshotWorkflowCatalog(ctx.catalog),
    triggerInput,
    resolvedInput: { [inputName]: recordIds.data },
    actorUserId: ctx.actorUserId,
    actorGroupIds: ctx.actorGroupIds,
    serviceAccountId: ctx.serviceAccountId,
  });
};

export const executeBulkSelection = async (params: ExecuteBulkSelectionWorkflowParams): Promise<Result<WorkflowRun>> => {
  const prepared = await prepareBulkSelection(params);
  if (!prepared.ok) return prepared;
  const item = prepared.data;
  return execute({
    ...params,
    triggerKind: "bulkSelection",
    triggerInput: item.triggerInput,
    resolvedInput: item.resolvedInput,
    actorUserId: item.actorUserId,
    actorGroupIds: item.actorGroupIds,
    serviceAccountId: item.serviceAccountId,
  });
};

type PreparedRecordEventWorkflowRun = {
  workflow: Workflow;
  workflowCatalog: WorkflowCatalogSnapshot;
  triggerInput: WorkflowRuntimeInput;
  resolvedInput: WorkflowRuntimeInput;
  actorUserId: string | null;
  actorGroupIds: string[];
  serviceAccountId: string | null;
};

export const prepareRecordEvent = async (params: ExecuteRecordEventWorkflowParams): Promise<Result<PreparedRecordEventWorkflowRun>> => {
  const workflow = await get(params.workflowId);
  if (!workflow) return fail(err.notFound("workflow"));
  if (!workflow.enabled) return fail(err.badInput("workflow is disabled"));
  const recordEvent = workflow.compiled.triggers.recordEvent;
  if (!recordEvent) return fail(err.badInput("workflow does not define a recordEvent trigger"));
  const eventName = recordEventName(params.event);
  if (!eventName || recordEvent.event !== eventName) return fail(err.badInput("record event does not match workflow trigger"));

  const catalog = await loadWorkflowCatalog(workflow.baseId);
  const principal = await workflowOwnerPrincipal(workflow);
  const ctx: RuntimeContext = {
    workflow,
    definition: workflow.compiled,
    catalog,
    runId: null,
    executionGeneration: null,
    actorUserId: principal.actorUserId,
    actorGroupIds: principal.actorGroupIds,
    serviceAccountId: principal.serviceAccountId,
    input: new Map(),
    variables: new Map(),
    records: new Map(),
    readableTableIds: new Set(),
    dateConfig: await workflowDateConfig(),
    leaseMs: params.leaseMs,
    heartbeat: params.heartbeat,
    notificationSender: params.notificationSender ?? defaultWorkflowNotificationSender,
    documentPdfRenderer: params.documentPdfRenderer,
  };
  const runPermission = await requireWorkflowRunPermission(ctx);
  if (!runPermission.ok) return runPermission;

  const input = recordEvent.input ? workflow.compiled.inputs?.[recordEvent.input] : null;
  const inputTable = input?.type === "record" && input.table ? resolveWorkflowTableRef(catalog, input.table) : null;
  const triggerTable = recordEvent.table ? resolveWorkflowTableRef(catalog, recordEvent.table) : null;
  const tableId = triggerTable?.id ?? inputTable?.id ?? null;
  if (recordEvent.input && !inputTable) return fail(err.badInput("recordEvent trigger input must be a record input"));
  if (tableId && tableId !== params.event.tableId) return fail(err.badInput("record event table does not match workflow trigger"));
  if (tableId) {
    const readPermission = await requireTableReadPermission(ctx, tableId);
    if (!readPermission.ok) return readPermission;
  }

  return ok({
    workflow,
    workflowCatalog: snapshotWorkflowCatalog(catalog),
    actorUserId: ctx.actorUserId,
    actorGroupIds: ctx.actorGroupIds,
    serviceAccountId: ctx.serviceAccountId,
    triggerInput: {
      event: params.event.type,
      tableId: params.event.tableId,
      recordId: params.event.recordId,
      version: params.event.version,
      changedFieldIds: params.event.changedFieldIds,
      eventActorUserId: params.event.actorId,
      occurredAt: params.event.occurredAt,
    },
    resolvedInput: recordEvent.input ? { [recordEvent.input]: params.event.recordId } : {},
  });
};

export const executeRecordEvent = async (params: ExecuteRecordEventWorkflowParams): Promise<Result<WorkflowRun>> => {
  const prepared = await prepareRecordEvent(params);
  if (!prepared.ok) return prepared;
  const item = prepared.data;
  return execute({
    ...params,
    workflowId: item.workflow.id,
    triggerKind: "recordEvent",
    actorUserId: item.actorUserId,
    actorGroupIds: item.actorGroupIds,
    serviceAccountId: item.serviceAccountId,
    triggerInput: item.triggerInput,
    resolvedInput: item.resolvedInput,
  });
};
