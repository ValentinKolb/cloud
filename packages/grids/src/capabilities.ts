import { err, fail, ok } from "@k2b/stdlib";
import {
  type CapabilityExecutionContext,
  type CloudResourceRef,
  type CloudResourceView,
  defineCapabilities,
  UniversalSearchDataSchema,
  type UniversalSearchInput,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import type { z } from "zod";
import {
  buildPermissionedGqlResolverContextForAccess,
  emptyDslAst,
  executeGqlSourceForContext,
  executeSavedViewSourceForContext,
  type GridsGqlRuntimeContext,
} from "./api/gql-runtime";
import {
  accessActorUser,
  actorViewerFor,
  type GridsAccessContext,
  gateAtAccess,
  gateCredentialScopeFor,
  resourceBoundBaseIdFor,
} from "./api/permissions";
import { isQueryAdmissionError } from "./api/query-admission";
import {
  BaseCapabilityDataSchema,
  BaseGetInputSchema,
  BaseListDataSchema,
  BaseListInputSchema,
  GqlContextDataSchema,
  GqlContextInputSchema,
  type GqlContextItemSchema,
  GqlExecuteInputSchema,
  GqlPreviewInputSchema,
  GqlResultDataSchema,
  GqlViewExecuteInputSchema,
  RecordCapabilityDataSchema,
  RecordCreateInputSchema,
  RecordGetInputSchema,
  RecordUpdateInputSchema,
} from "./capability-contracts";
import type { DslQueryPreviewResponse } from "./contracts";
import { isRecordWritableFieldType } from "./field-types";
import { gridsService } from "./service";
import type { Base, Field, GridRecord, Table } from "./service/types";

const capabilityDateConfig = async () => ({
  timeZone: normalizeTimeZone(String((await settingsGet<string>("app.timezone")) || "").trim(), "UTC"),
  locale: "en" as const,
  firstDayOfWeek: 1 as const,
});

const accessContext = (context: CapabilityExecutionContext): GridsAccessContext => ({
  actor: context.actor,
  accessSubject: context.accessSubject,
});

const gqlRuntimeContext = async (context: CapabilityExecutionContext): Promise<GridsGqlRuntimeContext> => ({
  access: accessContext(context),
  dateConfig: await capabilityDateConfig(),
  signal: context.signal,
});

const encodeCursor = (offset: number): string => Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");

const decodeCursor = (cursor: string | undefined) => {
  if (!cursor) return ok(0);
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; offset?: unknown };
    return value.v === 1 && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0
      ? ok(Number(value.offset))
      : fail(err.badInput("Invalid cursor"));
  } catch {
    return fail(err.badInput("Invalid cursor"));
  }
};

const mapBase = (base: Base) => ({
  id: base.id,
  shortId: base.shortId,
  name: base.name,
  description: base.description,
  createdAt: base.createdAt,
  updatedAt: base.updatedAt,
});

const baseHref = (base: Pick<Base, "shortId">) => `/app/grids/${base.shortId}`;
const tableHref = (base: Pick<Base, "shortId">, table: Pick<Table, "shortId">) => `${baseHref(base)}/table/${table.shortId}`;
const recordHref = (base: Pick<Base, "shortId">, table: Pick<Table, "shortId">, recordId: string) =>
  `${tableHref(base, table)}?record=${encodeURIComponent(recordId)}`;

const visibleBaseParams = (access: GridsAccessContext) => {
  const viewer = actorViewerFor(access);
  const boundBaseId = resourceBoundBaseIdFor(access);
  return { viewer, boundBaseId };
};

const runBaseSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const access = accessContext(context);
  const scope = await gateCredentialScopeFor(access, "read");
  const { viewer, boundBaseId } = visibleBaseParams(access);
  if (!scope.ok || boundBaseId === null) return ok({ data: [] });
  const result = await gridsService.base.listVisible({
    ...viewer,
    ...(boundBaseId ? { baseId: boundBaseId } : {}),
    query: input.query,
    limit: input.limit,
    offset: 0,
  });
  const data: CloudResourceView[] = result.items.map((base) => ({
    ref: { type: "grids.base", id: base.id },
    title: base.name,
    preview: base.description ?? undefined,
    icon: "ti ti-table",
    priority: 7,
    metadata: [{ label: "Type", value: "Base" }],
    links: [{ rel: "open", href: baseHref(base) }],
  }));
  return ok({ data });
};

const runBaseList = async (input: z.infer<typeof BaseListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const access = accessContext(context);
  const scope = await gateCredentialScopeFor(access, "read");
  if (!scope.ok) return scope;
  const { viewer, boundBaseId } = visibleBaseParams(access);
  if (boundBaseId === null) return fail(err.forbidden("This credential is not bound to a Grids Base."));
  const result = await gridsService.base.listVisible({
    ...viewer,
    ...(boundBaseId ? { baseId: boundBaseId } : {}),
    query: input.query,
    limit: input.limit,
    offset: cursor.data,
  });
  const data = result.items.map(mapBase);
  const nextOffset = cursor.data + data.length;
  const hasMore = nextOffset < result.total;
  return ok({
    data,
    refs: data.map((base) => ({ type: "grids.base", id: base.id })),
    page: { hasMore, ...(hasMore ? { nextCursor: encodeCursor(nextOffset) } : {}) },
  });
};

const requireBase = async (baseId: string, access: GridsAccessContext) => {
  const gate = await gateAtAccess(access, { baseId }, "read");
  if (!gate.ok) return gate;
  const base = await gridsService.base.get(baseId);
  return base ? ok(base) : fail(err.notFound("Base"));
};

const requireTable = async (tableId: string, access: GridsAccessContext, required: "read" | "write") => {
  const table = await gridsService.table.get(tableId);
  if (!table) return fail(err.notFound("Table"));
  const gate = await gateAtAccess(access, { baseId: table.baseId, tableId }, required);
  return gate.ok ? ok(table) : gate;
};

const runBaseGet = async (input: z.infer<typeof BaseGetInputSchema>, context: CapabilityExecutionContext) => {
  const result = await requireBase(input.baseId, accessContext(context));
  if (!result.ok) return result;
  return ok({
    data: mapBase(result.data),
    refs: [{ type: "grids.base", id: result.data.id }],
    links: [{ rel: "open" as const, href: baseHref(result.data) }],
  });
};

const selectOptions = (field: Field): Array<{ id: string; label: string; description: string | null }> => {
  const options = (field.config as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (!option || typeof option !== "object") return [];
    const { id, label, description } = option as { id?: unknown; label?: unknown; description?: unknown };
    if (typeof id !== "string" || !id || id.length > 10_000) return [];
    const readableLabel = typeof label === "string" && label.trim() ? label.trim() : id;
    return [{ id, label: readableLabel.slice(0, 500), description: typeof description === "string" ? description.slice(0, 1_000) : null }];
  });
};

const fieldValueHint = (field: Field): string | null => {
  const config = field.config as Record<string, unknown>;
  switch (field.type) {
    case "text":
    case "longtext":
      return "String; use null to clear an optional field.";
    case "number":
      return "Finite number or numeric string; use null to clear an optional field.";
    case "percent":
      return config.range === "fraction" ? "Number from 0 to 1." : "Number from 0 to 100.";
    case "boolean":
      return "Boolean true or false; use null to clear an optional field.";
    case "date":
      return config.includeTime ? "Timezone-aware ISO 8601 date-time string." : "Calendar date string in YYYY-MM-DD format.";
    case "duration":
      return "Non-negative seconds or a MM:SS/HH:MM:SS string.";
    case "select":
      return "Array of option IDs; load them with gql.context kind options for this field.";
    case "json":
      return "Any JSON value; use null to clear an optional field.";
    case "relation":
      return config.cardinality === "single" ? "One target record UUID or null." : "Array of target record UUIDs or null.";
    default:
      return null;
  }
};

type GqlContextItem = z.infer<typeof GqlContextItemSchema>;
type TableContextItem = Extract<GqlContextItem, { kind: "table" }>;

const tableContextItem = (table: Table, permission: "read" | "write" | "admin"): TableContextItem => ({
  kind: "table",
  id: table.id,
  shortId: table.shortId,
  baseId: table.baseId,
  tableKind: table.kind,
  name: table.name,
  description: table.description,
  icon: table.icon ?? null,
  permission,
  canCreateRecords: table.kind === "stored" && permission !== "read" && !table.disableDirectInsert,
  canUpdateRecords: table.kind === "stored" && permission !== "read",
});

const fieldContextItem = (field: Field, readableTableIds: ReadonlySet<string>, canUpdateRecords: boolean): GqlContextItem => {
  const configuredTarget = (field.config as { targetTableId?: unknown }).targetTableId;
  const targetTableId = typeof configuredTarget === "string" && readableTableIds.has(configuredTarget) ? configuredTarget : null;
  const configuredCardinality = (field.config as { cardinality?: unknown }).cardinality;
  return {
    kind: "field",
    id: field.id,
    shortId: field.shortId,
    tableId: field.tableId,
    name: field.name,
    description: field.description,
    type: field.type,
    position: field.position,
    required: field.required,
    writable: canUpdateRecords && isRecordWritableFieldType(field.type),
    valueHint: fieldValueHint(field),
    targetTableId,
    relationCardinality:
      field.type === "relation" && (configuredCardinality === "single" || configuredCardinality === "multiple")
        ? configuredCardinality
        : field.type === "relation"
          ? "multiple"
          : null,
  };
};

const recordWriteContext = (table: Table, permission: "read" | "write" | "admin") => {
  const canUpdateRecords = table.kind === "stored" && permission !== "read";
  const updateAudit = canUpdateRecords && table.auditPolicy.update?.enabled ? table.auditPolicy.update : null;
  return {
    tableId: table.id,
    canCreateRecords: canUpdateRecords && !table.disableDirectInsert,
    canUpdateRecords,
    updateAudit: updateAudit
      ? {
          scope: updateAudit.scope,
          fieldIds: updateAudit.fieldIds,
          questions: auditQuestions(table),
        }
      : null,
  };
};

const auditQuestions = (table: Table) =>
  table.auditPolicy.update?.questions.map((question) => ({
    ...question,
    description: question.description ?? null,
  })) ?? [];

const pageContextItems = (items: GqlContextItem[], offset: number, limit: number) => {
  const data = items.slice(offset, offset + limit);
  const nextOffset = offset + data.length;
  const hasMore = nextOffset < items.length;
  return { data, page: { hasMore, ...(hasMore ? { nextCursor: encodeCursor(nextOffset) } : {}) } };
};

const runGqlContext = async (input: z.infer<typeof GqlContextInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const access = accessContext(context);
  const baseResult = await requireBase(input.baseId, access);
  if (!baseResult.ok) return baseResult;

  let items: GqlContextItem[];
  let recordWrite: ReturnType<typeof recordWriteContext> | null = null;
  if (input.kind === "tables") {
    const [resolver, tables] = await Promise.all([
      buildPermissionedGqlResolverContextForAccess(access, input.baseId, undefined, undefined, emptyDslAst()),
      gridsService.table.listByBase(input.baseId),
    ]);
    const tablesById = new Map(tables.map((table) => [table.id, table]));
    const tableItems: TableContextItem[] = resolver.tables.flatMap((source) => {
      const table = tablesById.get(source.id);
      const permission = resolver.tablePermissionsById[source.id];
      return table && permission && permission !== "none" ? [tableContextItem(table, permission)] : [];
    });
    tableItems.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    items = tableItems;
  } else if (input.kind === "fields" || input.kind === "options") {
    if (!input.tableId) return fail(err.badInput(`tableId is required when kind is ${input.kind}`));
    if (input.kind === "options" && !input.fieldId) return fail(err.badInput("fieldId is required when kind is options"));
    const tableResult = await requireTable(input.tableId, access, "read");
    if (!tableResult.ok || tableResult.data.baseId !== input.baseId) return fail(err.notFound("Table"));
    const resolver = await buildPermissionedGqlResolverContextForAccess(
      access,
      input.baseId,
      input.tableId,
      { kind: "table", tableId: input.tableId },
      emptyDslAst(),
    );
    const table = resolver.tables.find((candidate) => candidate.id === input.tableId);
    if (!table) return fail(err.notFound("Table"));
    const permission = resolver.tablePermissionsById[input.tableId];
    if (!permission || permission === "none") return fail(err.notFound("Table"));
    const readableTableIds = new Set(resolver.tables.map((candidate) => candidate.id));
    const fields = (resolver.fieldsByTableId[input.tableId] ?? []).filter((field) => !field.deletedAt);
    if (input.kind === "fields") {
      const writeContext = recordWriteContext(tableResult.data, permission);
      recordWrite = writeContext;
      items = fields
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .map((field) => fieldContextItem(field, readableTableIds, writeContext.canUpdateRecords));
    } else {
      const field = fields.find((candidate) => candidate.id === input.fieldId);
      if (!field || field.type !== "select") return fail(err.notFound("Select field"));
      items = selectOptions(field).map((option) => ({ kind: "option" as const, fieldId: field.id, ...option }));
    }
  } else {
    if (input.tableId) {
      const table = await requireTable(input.tableId, access, "read");
      if (!table.ok || table.data.baseId !== input.baseId) return fail(err.notFound("Table"));
    }
    const resolver = await buildPermissionedGqlResolverContextForAccess(access, input.baseId, undefined, undefined, emptyDslAst());
    const views = await gridsService.view.listForTables({
      tableIds: resolver.tables.map((table) => table.id),
      ...actorViewerFor(access),
    });
    items = views
      .filter((view) => !input.tableId || view.tableId === input.tableId)
      .map((view) => ({
        kind: "view" as const,
        id: view.id,
        shortId: view.shortId,
        tableId: view.tableId,
        name: view.name,
        description: view.description,
        icon: view.icon ?? null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  const page = pageContextItems(items, cursor.data, input.limit);
  const refs: CloudResourceRef[] = page.data.flatMap((item) =>
    item.kind === "table" || item.kind === "view" ? [{ type: `grids.${item.kind}` as "grids.table" | "grids.view", id: item.id }] : [],
  );
  return ok({
    data: { base: mapBase(baseResult.data), kind: input.kind, items: page.data, recordWrite },
    refs,
    page: page.page,
  });
};

const gqlCapabilityResult = (response: DslQueryPreviewResponse) => {
  if (!response.ok) return ok({ data: response });
  const { page, ...data } = response;
  const refs: CloudResourceRef[] = [];
  const seen = new Set<string>();
  for (const row of response.rows) {
    if (!row.recordId || seen.has(row.recordId)) continue;
    seen.add(row.recordId);
    refs.push({ type: "grids.record", id: row.recordId });
  }
  const nextCursor = page?.nextCursor ?? undefined;
  return ok({
    data,
    refs,
    page: { hasMore: Boolean(nextCursor), ...(nextCursor ? { nextCursor } : {}) },
  });
};

const gqlUnavailable = (error: unknown) =>
  isQueryAdmissionError(error) ? fail(err.internal("Grids is busy. Retry shortly.")) : Promise.reject(error);

const runGqlPreview = async (input: z.infer<typeof GqlPreviewInputSchema>, context: CapabilityExecutionContext) => {
  const access = accessContext(context);
  const base = await requireBase(input.baseId, access);
  if (!base.ok) return base;
  try {
    const result = await executeGqlSourceForContext(
      await gqlRuntimeContext(context),
      input.baseId,
      {
        query: input.query,
        currentTableId: input.currentTableId,
        currentSource: input.currentSource,
        cursor: input.cursor,
        pageSize: input.pageSize,
      },
      { maxRows: 25, operation: "preview" },
    );
    return gqlCapabilityResult(result.response);
  } catch (error) {
    return gqlUnavailable(error);
  }
};

const runGqlExecute = async (input: z.infer<typeof GqlExecuteInputSchema>, context: CapabilityExecutionContext) => {
  const access = accessContext(context);
  const base = await requireBase(input.baseId, access);
  if (!base.ok) return base;
  try {
    const result = await executeGqlSourceForContext(
      await gqlRuntimeContext(context),
      input.baseId,
      {
        query: input.query,
        currentTableId: input.currentTableId,
        currentSource: input.currentSource,
        cursor: input.cursor,
        pageSize: input.pageSize,
        limit: input.limit,
      },
      { maxRows: 1_000, operation: "execute" },
    );
    return gqlCapabilityResult(result.response);
  } catch (error) {
    return gqlUnavailable(error);
  }
};

const runGqlViewExecute = async (input: z.infer<typeof GqlViewExecuteInputSchema>, context: CapabilityExecutionContext) => {
  try {
    const response = await executeSavedViewSourceForContext(await gqlRuntimeContext(context), input.baseId, input.viewId, {
      maxRows: 1_000,
      pageSize: input.pageSize,
      cursor: input.cursor,
      operation: "execute",
      surface: "api",
    });
    return gqlCapabilityResult(response);
  } catch (error) {
    return gqlUnavailable(error);
  }
};

const mapRecord = (record: GridRecord) => ({
  id: record.id,
  tableId: record.tableId,
  data: record.data,
  version: record.version,
  deletedAt: record.deletedAt,
  createdBy: record.createdBy,
  updatedBy: record.updatedBy,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const recordResult = async (record: GridRecord, table: Table) => {
  const base = await gridsService.base.get(table.baseId);
  return ok({
    data: mapRecord(record),
    refs: [{ type: "grids.record", id: record.id }],
    ...(base ? { links: [{ rel: "open" as const, href: recordHref(base, table, record.id) }] } : {}),
  });
};

const runRecordGet = async (input: z.infer<typeof RecordGetInputSchema>, context: CapabilityExecutionContext) => {
  const access = accessContext(context);
  const table = await requireTable(input.tableId, access, "read");
  if (!table.ok) return table;
  const dateConfig = await capabilityDateConfig();
  const record = await gridsService.record.get(input.tableId, input.recordId, {
    dateConfig,
    viewer: actorViewerFor(access),
  });
  return record ? recordResult(record, table.data) : fail(err.notFound("Record"));
};

const runRecordCreate = async (input: z.infer<typeof RecordCreateInputSchema>, context: CapabilityExecutionContext) => {
  const access = accessContext(context);
  const table = await requireTable(input.tableId, access, "write");
  if (!table.ok) return table;
  const dateConfig = await capabilityDateConfig();
  const result = await gridsService.record.create(input.tableId, input.values, accessActorUser(access)?.id ?? null, {
    dateConfig,
    viewer: actorViewerFor(access),
  });
  return result.ok ? recordResult(result.data, table.data) : result;
};

const runRecordUpdate = async (input: z.infer<typeof RecordUpdateInputSchema>, context: CapabilityExecutionContext) => {
  if (Object.keys(input.values).length === 0) return fail(err.badInput("values must contain at least one field"));
  const access = accessContext(context);
  const table = await requireTable(input.tableId, access, "write");
  if (!table.ok) return table;
  const dateConfig = await capabilityDateConfig();
  const result = await gridsService.record.update(
    input.tableId,
    input.recordId,
    input.values,
    accessActorUser(access)?.id ?? null,
    input.ifVersion,
    { dateConfig, viewer: actorViewerFor(access), audit: input.audit },
  );
  return result.ok ? recordResult(result.data, table.data) : result;
};

export const gridsCapabilities = defineCapabilities({
  version: 1,
  types: {
    base: { title: "Grids Base", description: "A permission-scoped Grids workspace.", icon: "ti ti-table" },
    table: { title: "Grids Table", description: "A readable stored or Combined table in a Base.", icon: "ti ti-table-column" },
    view: { title: "Grids View", description: "A permission-scoped saved GQL data view.", icon: "ti ti-layout-list" },
    record: { title: "Grids Record", description: "One stable record in a Grids Table.", icon: "ti ti-row-insert-bottom" },
  },
  queries: {
    "base.search": {
      title: "Search Grids Bases",
      description: "Find accessible Grids Bases by name, description, or short ID.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      openWorld: false,
      universalSearch: { tags: [{ tag: "grid", title: "Grids", description: "Show Grids Bases only.", aliases: ["grids", "base"] }] },
      run: runBaseSearch,
    },
    "base.list": {
      title: "List Grids Bases",
      description: "Start here to list accessible Grids Bases and obtain a baseId for schema or GQL calls.",
      input: BaseListInputSchema,
      data: BaseListDataSchema,
      openWorld: false,
      run: runBaseList,
    },
    "base.get": {
      title: "Get Grids Base",
      description: "Read one accessible Grids Base by stable ID.",
      input: BaseGetInputSchema,
      data: BaseCapabilityDataSchema,
      openWorld: false,
      run: runBaseGet,
    },
    "gql.context": {
      title: "Load Grids GQL context",
      description:
        "Discover a Base in steps: list Tables, then Fields and paginated select option IDs, or saved Views. Field results include effective write and audit requirements.",
      input: GqlContextInputSchema,
      data: GqlContextDataSchema,
      openWorld: false,
      run: runGqlContext,
    },
    "gql.preview": {
      title: "Preview Grids GQL",
      description:
        "Validate permission-safe GQL before execution and return actionable parser or resolver diagnostics without mutating data.",
      input: GqlPreviewInputSchema,
      data: GqlResultDataSchema,
      openWorld: false,
      run: runGqlPreview,
    },
    "gql.execute": {
      title: "Execute Grids GQL",
      description: "Execute permission-safe GQL after loading context; follow nextCursor for more rows, up to a 1,000-row logical ceiling.",
      input: GqlExecuteInputSchema,
      data: GqlResultDataSchema,
      openWorld: false,
      run: runGqlExecute,
    },
    "gql.view.execute": {
      title: "Execute saved Grids View",
      description: "Execute the exact stored GQL for a viewId returned by gql.context kind views; follow nextCursor for more rows.",
      input: GqlViewExecuteInputSchema,
      data: GqlResultDataSchema,
      openWorld: false,
      run: runGqlViewExecute,
    },
    "record.get": {
      title: "Get Grids Record",
      description: "Read one live record and obtain its current version for a conflict-safe record.update call.",
      input: RecordGetInputSchema,
      data: RecordCapabilityDataSchema,
      openWorld: false,
      run: runRecordGet,
    },
  },
  actions: {
    "record.create": {
      title: "Create Grids Record",
      description:
        "Call gql.context kind fields first, then create once with values keyed by writable Field UUID. Select values use option IDs. This action is not idempotent.",
      input: RecordCreateInputSchema,
      data: RecordCapabilityDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "table", inputField: "tableId" },
      run: runRecordCreate,
    },
    "record.update": {
      title: "Update Grids Record",
      description:
        "Load fields for value and audit requirements, then record.get for ifVersion. Only supplied Field UUIDs change; stale versions are rejected.",
      input: RecordUpdateInputSchema,
      data: RecordCapabilityDataSchema,
      destructive: true,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "record", inputField: "recordId" },
      review: async (input, context) => {
        if (Object.keys(input.values).length === 0) return fail(err.badInput("values must contain at least one field"));
        const access = accessContext(context);
        const table = await requireTable(input.tableId, access, "write");
        if (!table.ok) return table;
        const dateConfig = await capabilityDateConfig();
        const record = await gridsService.record.get(input.tableId, input.recordId, {
          dateConfig,
          viewer: actorViewerFor(access),
        });
        if (!record) return fail(err.notFound("Record"));
        const [base, fields] = await Promise.all([gridsService.base.get(table.data.baseId), gridsService.field.listByTable(input.tableId)]);
        const fieldNames = new Map(fields.map((field) => [field.id, field.name]));
        return ok({
          message: `Update one record in ${table.data.name}.`,
          details: [
            { label: "Table", value: table.data.name },
            { label: "Record", value: input.recordId },
            { label: "Current version", value: String(record.version) },
            {
              label: "Changed fields",
              value: Object.keys(input.values)
                .map((id) => fieldNames.get(id) ?? id)
                .join(", "),
            },
          ],
          ...(base ? { links: [{ rel: "open" as const, href: recordHref(base, table.data, input.recordId) }] } : {}),
        });
      },
      run: runRecordUpdate,
    },
  },
});
