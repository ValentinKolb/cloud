import { notifications } from "@valentinkolb/cloud/services";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { type DateContext, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  DocumentRun,
  RecordQuery,
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepRun,
  WorkflowTriggerKind,
  WorkflowValue,
} from "../contracts";
import { logAudit } from "./audit";
import { createDocumentLink, createRunForRecord, getTemplate, publicDocumentLinkUrl } from "./documents";
import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import type { GridsRecordEvent } from "./record-events";
import { create as createRecord, get as getRecord, list as listRecords, update as updateRecord } from "./records";
import { get as getTable } from "./tables";
import type { GridRecord, Table } from "./types";
import { executeWorkflowEmailAction, type WorkflowEmailAction, type WorkflowNotificationSender } from "./workflow-email-action";
import { requestWorkflowHttp } from "./workflow-http-client";
import {
  claimRun,
  createStepRun,
  createWorkflowRun,
  finishRun,
  finishStepRun,
  get,
  getRecordScanCode,
  getStepRunByPath,
  getWorkflowRun,
  heartbeatRun,
  loadWorkflowCatalog,
  resolveWorkflowFieldRef,
  resolveWorkflowTableRef,
  resolveWorkflowTemplateRef,
  type WorkflowCatalog,
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
type RuntimeStep = Record<string, unknown>;

export type WorkflowRuntimeInput = Record<string, unknown>;

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
};

export type WorkflowTriggerAuthorization =
  | { kind: "workflow" }
  | { kind: "dashboard-widget"; dashboardId: string; dashboardWidgetId: string };

type ExecutePreparedWorkflowRunParams = ExecuteWorkflowParams & {
  runId: string;
  authorization: WorkflowTriggerAuthorization;
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

type RuntimeContext = {
  workflow: Workflow;
  definition: WorkflowDefinition;
  catalog: WorkflowCatalog;
  runId: string | null;
  actorUserId: string | null;
  actorGroupIds: string[];
  serviceAccountId: string | null;
  input: Map<string, RuntimeValue>;
  variables: Map<string, RuntimeValue>;
  records: Map<string, GridRecord>;
  dateConfig: DateContext;
  leaseMs?: number;
  heartbeat?: () => Promise<void>;
  notificationSender: WorkflowNotificationSender;
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

const requireTableReadPermission = async (ctx: RuntimeContext, tableId: string): Promise<Result<void>> =>
  requirePermission(ctx, { tableId }, "read");

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

const createRuntimeContext = async (params: ExecuteWorkflowParams, workflow: Workflow): Promise<RuntimeContext> => ({
  workflow,
  definition: workflow.compiled,
  catalog: await loadWorkflowCatalog(workflow.baseId),
  runId: null,
  actorUserId: params.actorUserId ?? null,
  actorGroupIds: params.actorGroupIds ?? [],
  serviceAccountId: params.serviceAccountId ?? null,
  input: new Map(),
  variables: new Map(),
  records: new Map(),
  dateConfig: await workflowDateConfig(),
  leaseMs: params.leaseMs,
  heartbeat: params.heartbeat,
  notificationSender: params.notificationSender ?? notifications,
});

const plainResolvedInput = (ctx: RuntimeContext): WorkflowRuntimeInput =>
  Object.fromEntries([...ctx.input.entries()].map(([key, value]) => [key, valueToPlain(value)]));

type WorkflowExecutionPreparation = PreparedWorkflowTriggerRun & {
  ctx: RuntimeContext;
};

const prepareWorkflowExecution = async (
  params: ExecuteWorkflowParams,
  authorization: WorkflowTriggerAuthorization = { kind: "workflow" },
): Promise<Result<WorkflowExecutionPreparation>> => {
  const workflow = await get(params.workflowId);
  if (!workflow) return fail(err.notFound("workflow"));
  if (!workflow.enabled) return fail(err.badInput("workflow is disabled"));
  const trigger = requireDeclaredTrigger(workflow.compiled, params.triggerKind);
  if (!trigger.ok) return trigger;
  const ctx = await createRuntimeContext(params, workflow);
  if (authorization.kind === "workflow") {
    const permission = await requireWorkflowRunPermission(ctx);
    if (!permission.ok) return permission;
  }
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
  if (!isRecord(root)) return fail(err.badInput(`"${fieldRef}" requires a record value`));
  const field = resolveWorkflowFieldRef(ctx.catalog, root.tableId, fieldRef);
  if (!field) return fail(err.badInput(`unknown workflow field "${fieldRef}"`));
  const record = await readRecord(ctx, root);
  if (!record.ok) return record;
  const gridRecord = record.data;
  return ok((gridRecord.data[field.id] ?? null) as RuntimeValue);
};

const evaluateValue = async (ctx: RuntimeContext, value: WorkflowValue): Promise<Result<RuntimeValue>> => {
  if (typeof value === "string") {
    if (value === "now()") return ok(new Date().toISOString());
    const [rootName, ...path] = value.split(".");
    if (rootName === "inputs") {
      const inputName = path.shift() ?? "";
      const root = ctx.input.get(inputName);
      if (root === undefined) return fail(err.badInput(`workflow value references unknown input "${inputName}"`));
      return path.length > 0 ? readPathValue(ctx, root, path.join(".")) : ok(root);
    }
    const root = ctx.variables.get(rootName ?? "");
    if (root === undefined) return ok(value);
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

const valuesEqual = (left: RuntimeValue, right: RuntimeValue): boolean =>
  JSON.stringify(valueToPlain(left)) === JSON.stringify(valueToPlain(right));

const MESSAGE_EXPR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

const stringifyMessageValue = (value: RuntimeValue): string => {
  const plain = valueToPlain(value);
  if (plain === null || plain === undefined) return "";
  if (typeof plain === "string") return plain;
  if (typeof plain === "number" || typeof plain === "boolean") return String(plain);
  return JSON.stringify(plain);
};

const evaluateMessageExpression = async (ctx: RuntimeContext, expression: string): Promise<Result<string>> => {
  if (expression === "now()") {
    const value = await evaluateValue(ctx, expression);
    return value.ok ? ok(stringifyMessageValue(value.data)) : value;
  }
  const [rootName, inputName] = expression.split(".");
  if (!rootName) return fail(err.badInput("workflow message expression is empty"));
  if (rootName === "inputs") {
    if (!inputName || !ctx.input.has(inputName))
      return fail(err.badInput(`message expression "${expression}" references an unknown input`));
  } else if (!ctx.variables.has(rootName)) {
    return fail(err.badInput(`message expression "${expression}" references an unknown value`));
  }
  const value = await evaluateValue(ctx, expression);
  return value.ok ? ok(stringifyMessageValue(value.data)) : value;
};

const renderRuntimeMessage = async (ctx: RuntimeContext, raw: unknown, fallback: string): Promise<Result<string>> => {
  const template = String(raw ?? fallback);
  let rendered = "";
  let cursor = 0;
  for (const match of template.matchAll(MESSAGE_EXPR_RE)) {
    const index = match.index ?? 0;
    rendered += template.slice(cursor, index);
    const expression = match[1]?.trim() ?? "";
    const evaluated = await evaluateMessageExpression(ctx, expression);
    if (!evaluated.ok) return evaluated;
    rendered += evaluated.data;
    cursor = index + match[0].length;
  }
  rendered += template.slice(cursor);
  if (rendered.length > 1000) return fail(err.badInput("workflow message renders longer than 1000 characters"));
  return ok(rendered);
};

const stepOutputValue = (value: RuntimeValue | null): unknown => {
  if (value === null) return null;
  if (isRecord(value)) return { kind: "record", tableId: value.tableId, recordId: value.recordId };
  if (isRecordList(value)) return { kind: "recordList", tableId: value.tableId, count: value.recordIds.length };
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
    const value = await evaluateValue(ctx, condition.exists);
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
  const recordValue = await evaluateValue(ctx, action.record);
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
  const recordValue = await evaluateValue(ctx, action.record);
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
    dateConfig: ctx.dateConfig,
    filename: filename && typeof filename.data === "string" ? filename.data : null,
    tags,
    workflowRunId: ctx.runId,
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
  const documentValue = await evaluateValue(ctx, action.document);
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

const executeSendEmail = (ctx: RuntimeContext, action: WorkflowEmailAction): Promise<Result<WorkflowValue>> =>
  executeWorkflowEmailAction(
    {
      workflow: ctx.workflow,
      catalog: ctx.catalog,
      runId: ctx.runId,
      actorUserId: ctx.actorUserId,
      serviceAccountId: ctx.serviceAccountId,
      notificationSender: ctx.notificationSender,
      evaluate: (value) => evaluateValue(ctx, value),
      toPlain: valueToPlain,
      saveVariable: (name, value) => ctx.variables.set(name, value),
    },
    action,
  );

const executeHttpRequest = async (ctx: RuntimeContext, action: RuntimeHttpRequestAction): Promise<Result<RuntimeValue>> => {
  const payload = action.json === undefined ? undefined : await evaluateValue(ctx, action.json);
  if (payload && !payload.ok) return payload;
  const started = Date.now();
  const host = new URL(action.url).host;
  const response = await requestWorkflowHttp({
    url: action.url,
    method: action.method,
    headers: action.headers,
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

const stepKind = (step: WorkflowStep): string => Object.keys(step as RuntimeStep)[0] ?? "unknown";

const heartbeatWorkflow = async (ctx: RuntimeContext): Promise<void> => {
  if (!ctx.runId) return;
  await Promise.all([heartbeatRun(ctx.runId, ctx.leaseMs), ctx.heartbeat?.()]);
};

const executeSteps = async (
  ctx: RuntimeContext,
  steps: WorkflowStep[],
  runId: string,
  path: string,
): Promise<Result<RuntimeValue | null>> => {
  let last: RuntimeValue | null = null;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const item = step as RuntimeStep;
    const currentPath = `${path}.${index}`;
    const kind = stepKind(step);
    await heartbeatWorkflow(ctx);
    const previousStepRun = await getStepRunByPath(runId, currentPath);
    if (previousStepRun?.status === "running" && isSideEffectStep(item)) {
      return fail(err.conflict(`workflow step "${currentPath}" was interrupted during a side effect and cannot be retried safely`));
    }
    const stepRun = await createStepRun({ runId, stepIndex: index, stepPath: currentPath, kind, input: { kind } });
    if (stepRun.status === "succeeded") {
      const restored = restoreSucceededStep(ctx, item, stepRun);
      if (!restored.ok) return restored;
      await heartbeatWorkflow(ctx);
      last = restored.data;
      if (isWorkflowSucceed(last)) break;
      continue;
    }
    let result: Result<RuntimeValue | null>;
    if ("updateRecord" in item) result = await executeUpdateRecord(ctx, item.updateRecord as RuntimeUpdateRecordAction);
    else if ("createRecord" in item) result = await executeCreateRecord(ctx, item.createRecord as RuntimeCreateRecordAction);
    else if ("generateDocument" in item)
      result = await executeGenerateDocument(ctx, item.generateDocument as RuntimeGenerateDocumentAction);
    else if ("createDocumentLink" in item)
      result = await executeCreateDocumentLink(ctx, item.createDocumentLink as RuntimeCreateDocumentLinkAction);
    else if ("sendEmail" in item) result = await executeSendEmail(ctx, item.sendEmail as WorkflowEmailAction);
    else if ("httpRequest" in item) result = await executeHttpRequest(ctx, item.httpRequest as RuntimeHttpRequestAction);
    else if ("setVariable" in item) {
      const action = item.setVariable as RuntimeSetVariableAction;
      const evaluated = await evaluateValue(ctx, action.value);
      if (evaluated.ok) ctx.variables.set(action.name, evaluated.data);
      result = evaluated;
    } else if ("fail" in item) {
      const message = await renderRuntimeMessage(ctx, (item.fail as { message?: unknown }).message, "workflow failed");
      result = message.ok ? fail(err.badInput(message.data)) : message;
    } else if ("succeed" in item) {
      const message = await renderRuntimeMessage(ctx, (item.succeed as { message?: unknown }).message, "workflow succeeded");
      result = message.ok ? ok({ kind: "workflowSucceed", message: message.data }) : message;
    } else if ("if" in item) {
      const condition = item.if as RuntimeCondition;
      const matched = await evaluateCondition(ctx, condition);
      const branches = item as { then?: WorkflowStep[]; else?: WorkflowStep[] };
      result = matched.ok
        ? await executeSteps(
            ctx,
            matched.data ? (branches.then ?? []) : (branches.else ?? []),
            runId,
            `${currentPath}.${matched.data ? "then" : "else"}`,
          )
        : matched;
    } else if ("switch" in item) {
      const switched = await evaluateValue(ctx, item.switch as WorkflowValue);
      if (!switched.ok) result = switched;
      else {
        let found: { do: WorkflowStep[] } | null = null;
        let switchResult: Result<RuntimeValue | null> | null = null;
        for (const candidate of (item as { cases?: Array<{ when: WorkflowValue; do: WorkflowStep[] }> }).cases ?? []) {
          const when = await evaluateValue(ctx, candidate.when);
          if (!when.ok) {
            switchResult = when;
            found = null;
            break;
          }
          if (valuesEqual(switched.data, when.data)) {
            found = candidate;
            break;
          }
        }
        result =
          switchResult ??
          (await executeSteps(ctx, found?.do ?? (item as { default?: WorkflowStep[] }).default ?? [], runId, `${currentPath}.switch`));
      }
    } else if ("forEach" in item) {
      const list = await evaluateValue(ctx, item.forEach as string);
      if (!list.ok) result = list;
      else if (!isRecordList(list.data)) result = fail(err.badInput("forEach must resolve to a recordList"));
      else if (list.data.recordIds.length > MAX_LOOP_ITEMS)
        result = fail(err.badInput(`forEach supports at most ${MAX_LOOP_ITEMS} records per run`));
      else {
        const alias = String((item as { as?: unknown }).as ?? "");
        const body = (item as { do?: WorkflowStep[] }).do ?? [];
        result = ok(null);
        for (const recordId of list.data.recordIds) {
          await heartbeatWorkflow(ctx);
          ctx.variables.set(alias, { kind: "record", tableId: list.data.tableId, recordId });
          result = await executeSteps(ctx, body, runId, `${currentPath}.do.${recordId}`);
          if (!result.ok || isWorkflowSucceed(result.data)) break;
        }
      }
    } else result = fail(err.badInput(`unsupported workflow step "${kind}"`));

    await finishStepRun(stepRun.id, {
      status: result.ok ? "succeeded" : "failed",
      output: result.ok ? { ok: true, value: stepOutputValue(result.data) } : null,
      error: result.ok ? null : result.error.message,
    });
    await heartbeatWorkflow(ctx);
    if (!result.ok) return result;
    last = result.data;
    if (isWorkflowSucceed(last)) break;
  }
  return ok(last);
};

const isTerminalRun = (run: WorkflowRun): boolean => run.status === "succeeded" || run.status === "failed" || run.status === "canceled";

const executeWorkflowRun = async (
  params: ExecuteWorkflowParams,
  preparedRun: WorkflowRun | null = null,
  authorization: WorkflowTriggerAuthorization = { kind: "workflow" },
): Promise<Result<WorkflowRun>> => {
  let startedPreparedRun: WorkflowRun | null = null;
  if (preparedRun) {
    if (preparedRun.workflowId !== params.workflowId) return fail(err.badInput("workflow run does not belong to this workflow"));
    if (preparedRun.triggerKind !== params.triggerKind) return fail(err.badInput("workflow run trigger does not match this execution"));
    if (isTerminalRun(preparedRun)) return ok(preparedRun);
    if (preparedRun.status !== "queued" && preparedRun.status !== "running") return ok(preparedRun);
    const claimed = await claimRun(preparedRun.id, undefined, params.leaseMs);
    if (!claimed.claimed || claimed.run.status !== "running") return ok(claimed.run);
    startedPreparedRun = claimed.run;
  }
  const prepared = await prepareWorkflowExecution(params, authorization);
  if (!prepared.ok) return prepared;
  const { workflow, ctx } = prepared.data;

  const run =
    startedPreparedRun ??
    (await createWorkflowRun({
      workflowId: workflow.id,
      baseId: workflow.baseId,
      triggerKind: params.triggerKind,
      triggerInput: params.triggerInput ?? null,
      resolvedInput: prepared.data.resolvedInput,
      actorUserId: ctx.actorUserId,
      actorGroupIds: ctx.actorGroupIds,
      serviceAccountId: ctx.serviceAccountId,
      authorization,
    }));
  let started = startedPreparedRun;
  if (!started) {
    const claimed = await claimRun(run.id, undefined, params.leaseMs);
    if (!claimed.claimed || claimed.run.status !== "running") return ok(claimed.run);
    started = claimed.run;
  }
  ctx.runId = started.id;
  await heartbeatWorkflow(ctx);
  try {
    const result = await executeSteps(ctx, workflow.compiled.steps, started.id, "steps");
    const finished = await finishRun(started.id, {
      status: result.ok ? "succeeded" : "failed",
      error: result.ok ? null : result.error.message,
      resultMessage: result.ok && isWorkflowSucceed(result.data) ? result.data.message : null,
    });
    return result.ok ? ok(finished) : fail(result.error);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(started.id, { status: "failed", error: message });
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
  });
};

export const executePreparedRun = async (params: ExecutePreparedWorkflowRunParams): Promise<Result<WorkflowRun>> => {
  const run = await getWorkflowRun(params.runId);
  if (!run) return fail(err.notFound("workflow run"));
  const result = await executeWorkflowRun(params, run, params.authorization);
  if (!result.ok) {
    const latest = await getWorkflowRun(params.runId);
    if (latest && (latest.status === "queued" || latest.status === "running")) {
      await finishRun(params.runId, { status: "failed", error: result.error.message });
    }
  }
  return result;
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
    actorUserId: params.actorUserId ?? null,
    actorGroupIds: params.actorGroupIds ?? [],
    serviceAccountId: params.serviceAccountId ?? null,
    input: new Map(),
    variables: new Map(),
    records: new Map(),
    dateConfig: await workflowDateConfig(),
    leaseMs: params.leaseMs,
    heartbeat: params.heartbeat,
    notificationSender: params.notificationSender ?? notifications,
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
    actorUserId: params.actorUserId ?? null,
    actorGroupIds: params.actorGroupIds ?? [],
    serviceAccountId: params.serviceAccountId ?? null,
    input: new Map(),
    variables: new Map(),
    records: new Map(),
    dateConfig: await workflowDateConfig(),
    notificationSender: params.notificationSender ?? notifications,
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
  if (authorization.kind === "workflow") {
    const runPermission = await requireWorkflowRunPermission(ctx);
    if (!runPermission.ok) return runPermission;
  }
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
    actorUserId: principal.actorUserId,
    actorGroupIds: principal.actorGroupIds,
    serviceAccountId: principal.serviceAccountId,
    input: new Map(),
    variables: new Map(),
    records: new Map(),
    dateConfig: await workflowDateConfig(),
    leaseMs: params.leaseMs,
    heartbeat: params.heartbeat,
    notificationSender: params.notificationSender ?? notifications,
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
