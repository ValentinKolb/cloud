import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import type { WorkflowInvocationMode, WorkflowInvocationReceipt, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { z } from "zod";
import { type RecordQuery, RecordQuerySchema } from "../contracts";
import type { GridsWorkflow, GridsWorkflowLauncher, GridsWorkflowLauncherConfig } from "../workflows/contracts";
import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import { list as listRecords } from "./records";
import { loadWorkflowCatalog, resolveWorkflowFieldRef } from "./workflow-catalog";
import { workflowConflict } from "./workflow-errors";
import { invokeGridsWorkflow } from "./workflow-kernel-runtime";
import { getWorkflow } from "./workflow-kernel-store";
import type { GridsWorkflowPrincipal } from "./workflow-kernel-values";
import { getLauncher } from "./workflow-launchers";

export const MAX_BULK_LAUNCHER_RECORDS = 10_000;

const SCAN_CODE_PATH_RE = /(?:^|\/)scan(?:\?|$)/;
const operationIdSchema = z.string().trim().min(1).max(120);
const jsonInputsSchema = z.record(z.string(), z.json());
const principalSchema = z
  .object({
    userId: z.string().uuid().nullable(),
    groupIds: z.array(z.string().uuid()).max(10_000),
    serviceAccountId: z.string().uuid().nullable(),
  })
  .strict();

const launcherAuthorizationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workflow") }).strict(),
  z
    .object({
      kind: z.literal("dashboard-widget"),
      dashboardId: z.string().uuid(),
      dashboardWidgetId: z.string().min(1),
    })
    .strict(),
]);

const invocationFields = {
  launcherId: z.string().uuid(),
  operationId: operationIdSchema,
  mode: z.enum(["execute", "dryRun"]),
  expectedRevision: z.number().int().positive().optional(),
  principal: principalSchema,
  authorization: launcherAuthorizationSchema.optional(),
  inputs: jsonInputsSchema.default({}),
  occurredAt: z.string().datetime({ offset: true }).optional(),
};

export const ScannerLauncherInvocationSchema = z
  .object({
    ...invocationFields,
    expectedRevision: z.number().int().positive(),
    scannedText: z.string().trim().min(1).max(4_096),
  })
  .strict();

const explicitRecordIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(MAX_BULK_LAUNCHER_RECORDS)
  .superRefine((recordIds, ctx) => {
    if (new Set(recordIds).size !== recordIds.length) ctx.addIssue({ code: "custom", message: "record IDs must be unique" });
  });

const BulkRecordIdsLauncherInvocationSchema = z
  .object({
    ...invocationFields,
    recordIds: explicitRecordIdsSchema,
  })
  .strict();

const BulkQueryLauncherInvocationSchema = z
  .object({
    ...invocationFields,
    query: RecordQuerySchema.strict(),
  })
  .strict();

export const BulkLauncherInvocationSchema = z.union([BulkRecordIdsLauncherInvocationSchema, BulkQueryLauncherInvocationSchema]);

export const DashboardLauncherInvocationSchema = z.object(invocationFields).strict();

const ScannerLauncherConfigSchema = z
  .object({
    kind: z.literal("scanner"),
    input: z.string().trim().min(1).max(120),
    resolve: z
      .object({
        by: z.enum(["scanCode", "field"]),
        field: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.resolve.by === "field" && !config.resolve.field) {
      ctx.addIssue({ code: "custom", path: ["resolve", "field"], message: "field resolution requires a field" });
    }
    if (config.resolve.by === "scanCode" && config.resolve.field !== undefined) {
      ctx.addIssue({ code: "custom", path: ["resolve", "field"], message: "scan-code resolution does not accept a field" });
    }
  });

const BulkLauncherConfigSchema = z.object({ kind: z.literal("bulk"), input: z.string().trim().min(1).max(120) }).strict();

const DashboardLauncherConfigSchema = z
  .object({
    kind: z.literal("dashboard"),
    label: z.string().trim().min(1).max(80).optional(),
    inputBindings: jsonInputsSchema.optional(),
  })
  .strict();

const StrictLauncherConfigSchema = z.discriminatedUnion("kind", [
  ScannerLauncherConfigSchema,
  BulkLauncherConfigSchema,
  DashboardLauncherConfigSchema,
]);

export type ScannerLauncherInvocation = z.infer<typeof ScannerLauncherInvocationSchema>;
export type BulkLauncherInvocation = z.infer<typeof BulkLauncherInvocationSchema>;
export type DashboardLauncherInvocation = z.infer<typeof DashboardLauncherInvocationSchema>;

type LauncherKind = GridsWorkflowLauncherConfig["kind"];

type LauncherContext = {
  launcher: GridsWorkflowLauncher;
  workflow: GridsWorkflow;
  config: z.infer<typeof StrictLauncherConfigSchema>;
  tableId: string | null;
};

type LauncherAuthorizationInput = {
  workflow: GridsWorkflow;
  principal: GridsWorkflowPrincipal;
  tableId: string | null;
  authorization?: z.infer<typeof launcherAuthorizationSchema>;
};

export type WorkflowKernelLauncherDeps = {
  getLauncher: typeof getLauncher;
  getWorkflow: typeof getWorkflow;
  authorize: (input: LauncherAuthorizationInput) => Promise<Result<void>>;
  resolveScanCode: (baseId: string, tableId: string, scannedText: string) => Promise<Result<string>>;
  resolveUniqueField: (baseId: string, tableId: string, fieldRef: string, scannedText: string) => Promise<Result<string>>;
  resolveExplicitRecordIds: (baseId: string, tableId: string, recordIds: string[]) => Promise<Result<string[]>>;
  resolveQueryRecordIds: (tableId: string, query: RecordQuery, principal: GridsWorkflowPrincipal) => Promise<Result<string[]>>;
  invokeWorkflow: typeof invokeGridsWorkflow;
};

const formatZodError = (error: z.ZodError): string => {
  const issue = error.issues[0];
  if (!issue) return "invalid input";
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
};

const normalizeScannedText = (value: string): string => {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed, "https://grids.local");
    const code = parsed.searchParams.get("code");
    if (code && SCAN_CODE_PATH_RE.test(parsed.pathname)) return code.trim();
  } catch {
    // Raw scanner values are expected.
  }
  return trimmed;
};

const authorize: WorkflowKernelLauncherDeps["authorize"] = async ({ workflow, principal, tableId, authorization }) => {
  const grants = await loadGrantsForUser({
    userId: principal.userId,
    userGroups: principal.groupIds,
    serviceAccountId: principal.serviceAccountId,
    baseId: workflow.baseId,
    workflowId: workflow.id,
    tableId,
  });
  if (
    authorization?.kind !== "dashboard-widget" &&
    !hasAtLeast(resolveEffectivePermission(grants, { baseId: workflow.baseId, workflowId: workflow.id }), "write")
  ) {
    return fail(err.forbidden("Workflow actor cannot run this workflow."));
  }
  if (tableId && !hasAtLeast(resolveEffectivePermission(grants, { baseId: workflow.baseId, tableId }), "read")) {
    return fail(err.forbidden("Workflow actor cannot read the launcher input table."));
  }
  return ok();
};

const resolveScanCode: WorkflowKernelLauncherDeps["resolveScanCode"] = async (baseId, tableId, scannedText) => {
  const [row] = await sql<Array<{ id: string }>>`
    SELECT r.id::text AS id
    FROM grids.record_scan_codes scan
    JOIN grids.records r ON r.id = scan.record_id AND r.deleted_at IS NULL
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE scan.code = ${scannedText}
      AND scan.active = TRUE
      AND scan.base_id = ${baseId}::uuid
      AND scan.table_id = ${tableId}::uuid
      AND r.table_id = ${tableId}::uuid
  `;
  return row ? ok(row.id) : fail(err.notFound("scan code"));
};

const resolveUniqueField: WorkflowKernelLauncherDeps["resolveUniqueField"] = async (baseId, tableId, fieldRef, scannedText) => {
  const field = resolveWorkflowFieldRef(await loadWorkflowCatalog(baseId), tableId, fieldRef);
  if (!field) return fail(err.badInput(`unknown or ambiguous scanner field "${fieldRef}"`));
  const [storedField] = await sql<Array<{ unique_constraint: boolean }>>`
    SELECT f.unique_constraint
    FROM grids.fields f
    JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE b.id = ${baseId}::uuid
      AND f.table_id = ${tableId}::uuid
      AND f.id = ${field.id}::uuid
      AND f.deleted_at IS NULL
  `;
  if (!storedField) return fail(err.badInput(`unknown scanner field "${fieldRef}"`));
  if (!storedField.unique_constraint) return fail(err.badInput(`scanner field "${fieldRef}" must enforce unique values`));
  const rows = await sql<Array<{ id: string }>>`
    SELECT r.id::text AS id
    FROM grids.records r
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE b.id = ${baseId}::uuid
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

const resolveExplicitRecordIds: WorkflowKernelLauncherDeps["resolveExplicitRecordIds"] = async (baseId, tableId, recordIds) => {
  const rows = await sql<Array<{ id: string }>>`
    SELECT r.id::text AS id
    FROM grids.records r
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE b.id = ${baseId}::uuid
      AND r.table_id = ${tableId}::uuid
      AND r.id = ANY(${sql.array(recordIds, "UUID")}::uuid[])
      AND r.deleted_at IS NULL
  `;
  const found = new Set(rows.map((row) => row.id));
  return found.size === recordIds.length ? ok(recordIds) : fail(err.notFound("bulk selection record"));
};

const resolveQueryRecordIds: WorkflowKernelLauncherDeps["resolveQueryRecordIds"] = async (tableId, query, principal) => {
  if ((query.groupBy?.length ?? 0) > 0 || (query.aggregations?.length ?? 0) > 0 || (query.groupSort?.length ?? 0) > 0) {
    return fail(err.badInput("bulk selection queries must be row-shaped"));
  }
  if (query.includeDeleted || query.deletedOnly) return fail(err.badInput("bulk selection queries cannot include deleted records"));

  const requestedCount = query.limit ?? MAX_BULK_LAUNCHER_RECORDS + 1;
  const ids: string[] = [];
  let cursor: string | null = null;
  const dateConfig = {
    timeZone: normalizeTimeZone(String((await settingsGet<string>("app.timezone")) || "").trim(), "UTC"),
    locale: "en",
    firstDayOfWeek: 1 as const,
  };
  while (ids.length < requestedCount) {
    const page = await listRecords({
      tableId,
      cursor,
      limit: Math.min(500, requestedCount - ids.length),
      filter: query.filter ?? null,
      search: query.search ?? null,
      recordMeta: query.recordMeta ?? null,
      sort: query.sort ?? [],
      viewer: { userId: principal.userId, userGroups: principal.groupIds, serviceAccountId: principal.serviceAccountId },
      dateConfig,
    });
    if (!page.ok) return page;
    ids.push(...page.data.items.map((record) => record.id));
    if (!page.data.nextCursor || page.data.items.length === 0) break;
    cursor = page.data.nextCursor;
  }
  if (ids.length === 0) return fail(err.badInput("bulk selection query returned no records"));
  if (ids.length > MAX_BULK_LAUNCHER_RECORDS) {
    return fail(err.badInput(`bulk selection supports at most ${MAX_BULK_LAUNCHER_RECORDS} records`));
  }
  return ok(ids);
};

const defaultDeps: WorkflowKernelLauncherDeps = {
  getLauncher,
  getWorkflow,
  authorize,
  resolveScanCode,
  resolveUniqueField,
  resolveExplicitRecordIds,
  resolveQueryRecordIds,
  invokeWorkflow: invokeGridsWorkflow,
};

const boundTableId = (workflow: GridsWorkflow, inputName: string): string | null => {
  const value = workflow.plan.bindings[`inputs.${inputName}.table`];
  return typeof value === "string" && z.string().uuid().safeParse(value).success ? value : null;
};

const loadLauncherContext = async (
  launcherId: string,
  expectedKind: LauncherKind,
  expectedRevision: number | undefined,
  deps: WorkflowKernelLauncherDeps,
): Promise<Result<LauncherContext>> => {
  const launcher = await deps.getLauncher(launcherId);
  if (!launcher) return fail(err.notFound("workflow launcher"));
  const config = StrictLauncherConfigSchema.safeParse(launcher.config);
  if (!config.success) return fail(err.badInput(`invalid workflow launcher config: ${formatZodError(config.error)}`));
  if (config.data.kind !== expectedKind) return fail(err.badInput(`workflow launcher is not a ${expectedKind} launcher`));
  if (!launcher.enabled || launcher.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return fail(err.badInput("workflow launcher is disabled or invalid"));
  }
  const workflow = await deps.getWorkflow(launcher.workflowId);
  if (!workflow || workflow.baseId !== launcher.baseId) return fail(err.notFound("workflow"));
  if (launcher.validatedRevision !== workflow.revision) return fail(workflowConflict("Workflow launcher must be revalidated."));
  if (expectedRevision !== undefined && workflow.revision !== expectedRevision) {
    return fail(workflowConflict("Workflow changed since the launcher operation started."));
  }

  let tableId: string | null = null;
  if (config.data.kind === "scanner" || config.data.kind === "bulk") {
    const inputName = config.data.input;
    const input = workflow.plan.inputs.find((candidate) => candidate.name === inputName);
    const expectedType = config.data.kind === "scanner" ? "record" : "recordList";
    if (!input || input.type !== expectedType) return fail(err.badInput(`${config.data.kind} launcher input contract is invalid`));
    tableId = boundTableId(workflow, inputName);
    if (!tableId) return fail(err.badInput(`${config.data.kind} launcher input has no bound table`));
  } else {
    const inputNames = new Set(workflow.plan.inputs.map((input) => input.name));
    const unknownBinding = Object.keys(config.data.inputBindings ?? {}).find((name) => !inputNames.has(name));
    if (unknownBinding) return fail(err.badInput(`dashboard launcher binds unknown workflow input "${unknownBinding}"`));
  }
  return ok({ launcher, workflow, config: config.data, tableId });
};

const idempotencyKey = (launcherId: string, operationId: string): string => `launcher:${launcherId}:${operationId}`;

const mergeInputs = (
  fixed: Record<string, WorkflowJsonValue>,
  supplied: Record<string, WorkflowJsonValue>,
): Result<Record<string, WorkflowJsonValue>> => {
  const conflict = Object.keys(fixed).find((name) => Object.hasOwn(supplied, name));
  return conflict
    ? fail(err.badInput(`launcher-controlled workflow input "${conflict}" cannot be overridden`))
    : ok({ ...supplied, ...fixed });
};

const invoke = (
  ctx: LauncherContext,
  input: {
    mode: WorkflowInvocationMode;
    operationId: string;
    expectedRevision?: number;
    principal: GridsWorkflowPrincipal;
    inputs: Record<string, WorkflowJsonValue>;
    occurredAt?: string;
    authorization?: z.infer<typeof launcherAuthorizationSchema>;
  },
  deps: WorkflowKernelLauncherDeps,
): Promise<Result<WorkflowInvocationReceipt>> =>
  deps.invokeWorkflow({
    workflowId: ctx.workflow.id,
    mode: input.mode,
    channel: ctx.config.kind,
    inputs: input.inputs,
    idempotencyKey: idempotencyKey(ctx.launcher.id, input.operationId),
    expectedRevision: input.expectedRevision,
    principal: input.principal,
    launcherId: ctx.launcher.id,
    authorization: input.authorization,
    occurredAt: input.occurredAt,
    context: { launcher: { id: ctx.launcher.id, kind: ctx.config.kind, operationId: input.operationId } },
  });

export const invokeScannerLauncher = async (
  rawInput: unknown,
  deps: WorkflowKernelLauncherDeps = defaultDeps,
): Promise<Result<WorkflowInvocationReceipt>> => {
  const input = ScannerLauncherInvocationSchema.safeParse(rawInput);
  if (!input.success) return fail(err.badInput(`invalid scanner launcher invocation: ${formatZodError(input.error)}`));
  const loaded = await loadLauncherContext(input.data.launcherId, "scanner", input.data.expectedRevision, deps);
  if (!loaded.ok) return loaded;
  const ctx = loaded.data;
  if (ctx.config.kind !== "scanner" || !ctx.tableId) return fail(err.internal("scanner launcher context is invalid"));
  const authorized = await deps.authorize({
    workflow: ctx.workflow,
    principal: input.data.principal,
    tableId: ctx.tableId,
    authorization: input.data.authorization,
  });
  if (!authorized.ok) return authorized;
  const scannedText = normalizeScannedText(input.data.scannedText);
  const recordId =
    ctx.config.resolve.by === "field"
      ? await deps.resolveUniqueField(ctx.workflow.baseId, ctx.tableId, ctx.config.resolve.field!, scannedText)
      : await deps.resolveScanCode(ctx.workflow.baseId, ctx.tableId, scannedText);
  if (!recordId.ok) return recordId;
  const inputs = mergeInputs({ [ctx.config.input]: recordId.data }, input.data.inputs);
  return inputs.ok ? invoke(ctx, { ...input.data, inputs: inputs.data }, deps) : inputs;
};

export const invokeBulkLauncher = async (
  rawInput: unknown,
  deps: WorkflowKernelLauncherDeps = defaultDeps,
): Promise<Result<WorkflowInvocationReceipt>> => {
  const input = BulkLauncherInvocationSchema.safeParse(rawInput);
  if (!input.success) return fail(err.badInput(`invalid bulk launcher invocation: ${formatZodError(input.error)}`));
  const loaded = await loadLauncherContext(input.data.launcherId, "bulk", input.data.expectedRevision, deps);
  if (!loaded.ok) return loaded;
  const ctx = loaded.data;
  if (ctx.config.kind !== "bulk" || !ctx.tableId) return fail(err.internal("bulk launcher context is invalid"));
  const authorized = await deps.authorize({
    workflow: ctx.workflow,
    principal: input.data.principal,
    tableId: ctx.tableId,
    authorization: input.data.authorization,
  });
  if (!authorized.ok) return authorized;
  const recordIds =
    "recordIds" in input.data
      ? await deps.resolveExplicitRecordIds(ctx.workflow.baseId, ctx.tableId, input.data.recordIds)
      : await deps.resolveQueryRecordIds(ctx.tableId, input.data.query, input.data.principal);
  if (!recordIds.ok) return recordIds;
  const inputs = mergeInputs({ [ctx.config.input]: recordIds.data }, input.data.inputs);
  return inputs.ok ? invoke(ctx, { ...input.data, inputs: inputs.data }, deps) : inputs;
};

export const invokeDashboardLauncher = async (
  rawInput: unknown,
  deps: WorkflowKernelLauncherDeps = defaultDeps,
): Promise<Result<WorkflowInvocationReceipt>> => {
  const input = DashboardLauncherInvocationSchema.safeParse(rawInput);
  if (!input.success) return fail(err.badInput(`invalid dashboard launcher invocation: ${formatZodError(input.error)}`));
  const loaded = await loadLauncherContext(input.data.launcherId, "dashboard", input.data.expectedRevision, deps);
  if (!loaded.ok) return loaded;
  const ctx = loaded.data;
  if (ctx.config.kind !== "dashboard") return fail(err.internal("dashboard launcher context is invalid"));
  const authorized = await deps.authorize({
    workflow: ctx.workflow,
    principal: input.data.principal,
    tableId: null,
    authorization: input.data.authorization,
  });
  if (!authorized.ok) return authorized;
  const inputs = mergeInputs(ctx.config.inputBindings ?? {}, input.data.inputs);
  return inputs.ok ? invoke(ctx, { ...input.data, inputs: inputs.data }, deps) : inputs;
};
