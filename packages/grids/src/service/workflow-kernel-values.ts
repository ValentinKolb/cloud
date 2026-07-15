import { getEffectiveGroupIds } from "@valentinkolb/cloud/server";
import type { WorkflowBoundPlan, WorkflowInvocation, WorkflowIrInput, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { workflowPathKey } from "@valentinkolb/cloud/workflows";
import type { WorkflowValueResolverPort, WorkflowVariableScope } from "@valentinkolb/cloud/workflows/runtime";
import { sql } from "bun";
import { z } from "zod";
import type { GridRecord } from "../contracts";
import type { GridsWorkflowChannel, GridsWorkflowPrincipal } from "../workflows/contracts";
import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import { createReader } from "./record-read";

export type WorkflowRecordReference = {
  kind: "record";
  tableId: string;
  recordId: string;
};

export type { GridsWorkflowPrincipal } from "../workflows/contracts";

type WorkflowInputPreparationDeps = {
  canReadTable: (tableId: string) => Promise<boolean>;
  existingRecordIds: (tableId: string, recordIds: string[]) => Promise<Set<string>>;
};

type WorkflowInputPreparationOptions = {
  trustedRecordIds?: ReadonlyMap<string, ReadonlySet<string>>;
  authorizeTable?: (tableId: string) => Promise<boolean>;
};

type WorkflowValueResolverDeps = {
  canReadTable: (tableId: string) => Promise<boolean>;
  readRecord: (tableId: string, recordId: string) => Promise<GridRecord | null>;
};

export class WorkflowInputPreparationError extends Error {
  override readonly name = "WorkflowInputPreparationError";

  constructor(
    message: string,
    readonly status: 400 | 403 = 400,
  ) {
    super(message);
  }
}

const uuid = z.string().uuid();

export const loadWorkflowUserGroupIds = async (userId: string | null): Promise<string[]> => {
  return getEffectiveGroupIds({ userId });
};

const isRecordReference = (value: WorkflowJsonValue | undefined): value is WorkflowRecordReference =>
  Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.kind === "record" &&
      typeof value.tableId === "string" &&
      typeof value.recordId === "string",
  );

const inputTableId = (plan: WorkflowBoundPlan, inputName: string): string | null => {
  const value = plan.bindings[`inputs.${inputName}.table`];
  return typeof value === "string" ? value : null;
};

const requiredInput = (config: Record<string, WorkflowJsonValue>): boolean => config.required === true;

const validateScalar = (type: string, value: WorkflowJsonValue, config: Record<string, WorkflowJsonValue>): string | null => {
  if (type === "text") return typeof value === "string" ? null : "must be text";
  if (type === "number") return typeof value === "number" && Number.isFinite(value) ? null : "must be a finite number";
  if (type === "boolean") return typeof value === "boolean" ? null : "must be true or false";
  if (type === "date") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "must be a date in YYYY-MM-DD format";
  if (type === "dateTime") {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? null : "must be an ISO date-time";
  }
  if (type === "select") {
    const options = Array.isArray(config.options) ? config.options.filter((option): option is string => typeof option === "string") : [];
    return typeof value === "string" && options.includes(value) ? null : "must be one of the configured options";
  }
  return `uses unsupported input type "${type}"`;
};

export const workflowInputShapeError = (input: WorkflowIrInput, value: WorkflowJsonValue | undefined): string | null => {
  if (value === undefined || value === null) return requiredInput(input.config) ? "is required" : null;
  if (input.type === "record") return typeof value === "string" && uuid.safeParse(value).success ? null : "must be a record ID";
  if (input.type === "recordList") {
    if (!Array.isArray(value) || value.some((recordId) => typeof recordId !== "string" || !uuid.safeParse(recordId).success)) {
      return "must contain record IDs";
    }
    return value.length <= 10_000 ? null : "exceeds the 10000 record limit";
  }
  return validateScalar(input.type, value, input.config);
};

const recordReference = (tableId: string, recordId: string): WorkflowRecordReference => ({ kind: "record", tableId, recordId });

const prepareRecordIds = async (
  tableId: string,
  recordIds: string[],
  deps: WorkflowInputPreparationDeps,
): Promise<WorkflowRecordReference[]> => {
  if (!(await deps.canReadTable(tableId))) throw new WorkflowInputPreparationError("workflow actor cannot read the input table", 403);
  if (recordIds.some((recordId) => !uuid.safeParse(recordId).success)) {
    throw new WorkflowInputPreparationError("contains an invalid record ID");
  }
  const uniqueIds = [...new Set(recordIds)];
  const existingIds = await deps.existingRecordIds(tableId, uniqueIds);
  const missing = uniqueIds.find((recordId) => !existingIds.has(recordId));
  if (missing) throw new WorkflowInputPreparationError(`references missing record "${missing}"`);
  return recordIds.map((recordId) => recordReference(tableId, recordId));
};

export const prepareWorkflowInputs = async (
  plan: WorkflowBoundPlan,
  rawInputs: Record<string, WorkflowJsonValue>,
  deps: WorkflowInputPreparationDeps,
): Promise<Record<string, WorkflowJsonValue>> => {
  const declaredNames = new Set(plan.inputs.map((input) => input.name));
  const unknownName = Object.keys(rawInputs).find((name) => !declaredNames.has(name));
  if (unknownName) throw new WorkflowInputPreparationError(`unknown workflow input "${unknownName}"`);

  const prepared: Record<string, WorkflowJsonValue> = {};
  for (const input of plan.inputs) {
    const value = rawInputs[input.name];
    const shapeError = workflowInputShapeError(input, value);
    if (shapeError) throw new WorkflowInputPreparationError(`workflow input "${input.name}" ${shapeError}`);
    if (value === undefined || value === null) {
      continue;
    }
    if (input.type === "record" || input.type === "recordList") {
      const tableId = inputTableId(plan, input.name);
      if (!tableId) throw new WorkflowInputPreparationError(`workflow input "${input.name}" has no bound table`);
      const rawRecordIds = input.type === "record" ? [value] : value;
      const recordIds = rawRecordIds as string[];
      const references = await prepareRecordIds(tableId, recordIds, deps);
      prepared[input.name] = input.type === "record" ? references[0]! : references;
      continue;
    }
    prepared[input.name] = value;
  }
  return prepared;
};

const rootValue = (
  invocation: WorkflowInvocation,
  variables: WorkflowVariableScope,
  reference: string,
): { value: WorkflowJsonValue | undefined; remaining: string[] } => {
  const remaining = reference.split(".");
  const root = remaining.shift() ?? "";
  if (root === "inputs") {
    const inputName = remaining.shift() ?? "";
    return { value: invocation.inputs[inputName], remaining };
  }
  if (root === "context") return { value: invocation.context ?? {}, remaining };
  return { value: variables.get(root), remaining };
};

export class GridsWorkflowValueResolver implements WorkflowValueResolverPort {
  private readonly readableTables = new Map<string, Promise<boolean>>();
  private readonly records = new Map<string, Promise<GridRecord | null>>();

  constructor(private readonly deps: WorkflowValueResolverDeps) {}

  private canReadTable(tableId: string): Promise<boolean> {
    let permission = this.readableTables.get(tableId);
    if (!permission) {
      permission = this.deps.canReadTable(tableId);
      this.readableTables.set(tableId, permission);
    }
    return permission;
  }

  private readRecord(tableId: string, recordId: string): Promise<GridRecord | null> {
    const key = `${tableId}:${recordId}`;
    let record = this.records.get(key);
    if (!record) {
      record = this.deps.readRecord(tableId, recordId);
      this.records.set(key, record);
    }
    return record;
  }

  async resolve(input: {
    reference: string;
    path: Array<string | number>;
    plan: WorkflowBoundPlan;
    invocation: WorkflowInvocation;
    variables: WorkflowVariableScope;
    fallback: () => WorkflowJsonValue | undefined;
  }): Promise<WorkflowJsonValue | undefined> {
    const { value, remaining } = rootValue(input.invocation, input.variables, input.reference);
    if (!isRecordReference(value) || remaining.length === 0) return input.fallback();
    const fieldId = input.plan.bindings[workflowPathKey(input.path)];
    if (typeof fieldId !== "string") throw new Error(`workflow field binding is unavailable at "${workflowPathKey(input.path)}"`);
    if (!(await this.canReadTable(value.tableId))) throw new Error("workflow actor cannot read the referenced table");
    const snapshots = input.invocation.context?.workflowRecordSnapshots;
    if (snapshots && typeof snapshots === "object" && !Array.isArray(snapshots)) {
      const snapshot = snapshots[`${value.tableId}:${value.recordId}`];
      if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) return snapshot[fieldId] ?? null;
    }
    const record = await this.readRecord(value.tableId, value.recordId);
    if (!record) throw new Error("referenced workflow record no longer exists");
    return (record.data[fieldId] ?? null) as WorkflowJsonValue;
  }
}

const permissionChecker =
  (baseId: string, principal: GridsWorkflowPrincipal, authorizeTable?: (tableId: string) => Promise<boolean>) =>
  async (tableId: string): Promise<boolean> => {
    if (authorizeTable) return authorizeTable(tableId);
    const grants = await loadGrantsForUser({
      userId: principal.userId,
      userGroups: principal.groupIds,
      serviceAccountId: principal.serviceAccountId,
      baseId,
      tableId,
    });
    return hasAtLeast(resolveEffectivePermission(grants, { baseId, tableId }), "read");
  };

export const createWorkflowInputPreparationDeps = (
  baseId: string,
  principal: GridsWorkflowPrincipal,
  options: WorkflowInputPreparationOptions = {},
): WorkflowInputPreparationDeps => ({
  canReadTable: permissionChecker(baseId, principal, options.authorizeTable),
  existingRecordIds: async (tableId, recordIds) => {
    if (recordIds.length === 0) return new Set();
    const rows = await sql<Array<{ id: string }>>`
      SELECT r.id::text AS id
      FROM grids.records r
      JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
      JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
      WHERE r.table_id = ${tableId}::uuid
        AND r.id = ANY(${sql.array(recordIds, "UUID")}::uuid[])
        AND r.deleted_at IS NULL
    `;
    const ids = new Set(rows.map((record) => record.id));
    const trusted = options.trustedRecordIds?.get(tableId);
    if (trusted) for (const recordId of recordIds) if (trusted.has(recordId)) ids.add(recordId);
    return ids;
  },
});

export const createGridsWorkflowValueResolver = (
  baseId: string,
  principal: GridsWorkflowPrincipal,
  options: Pick<WorkflowInputPreparationOptions, "authorizeTable"> = {},
): GridsWorkflowValueResolver => {
  const readers = new Map<string, ReturnType<typeof createReader>>();
  return new GridsWorkflowValueResolver({
    canReadTable: permissionChecker(baseId, principal, options.authorizeTable),
    readRecord: async (tableId, recordId) => {
      let reader = readers.get(tableId);
      if (!reader) {
        reader = createReader(tableId);
        readers.set(tableId, reader);
      }
      return (await reader).get(recordId);
    },
  });
};

export const workflowPrincipalFromInvocation = (invocation: WorkflowInvocation<GridsWorkflowChannel>): GridsWorkflowPrincipal => ({
  userId: invocation.actor.userId ?? null,
  groupIds: invocation.actor.groupIds ?? [],
  serviceAccountId: invocation.actor.serviceAccountId ?? null,
});
