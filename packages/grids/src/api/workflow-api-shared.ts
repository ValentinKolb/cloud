import type { AuthContext } from "@valentinkolb/cloud/server";
import { buildWorkflowManifestCompletions, workflowCompletionContext, workflowCompletionItem } from "@valentinkolb/cloud/workflows";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import type { Context } from "hono";
import { z } from "zod";
import { RecordQuerySchema } from "../contracts";
import { get as getBase } from "../service/bases";
import { listTemplatesForTable } from "../service/document-templates";
import { listForBase as listEmailTemplatesForBase } from "../service/email-templates";
import { listByTable as listFieldsByTable } from "../service/field-read";
import { hasAtLeast, loadBaseWorkflowGrantsForSubject, resolveEffectivePermission } from "../service/permission-resolver";
import { listByBase as listTablesByBase } from "../service/tables";
import { buildWorkflowCatalog, type WorkflowCatalog, type WorkflowCatalogEntry } from "../service/workflow-catalog";
import { listWorkflowScopes, listWorkflows } from "../service/workflow-definitions";
import { bindGridsWorkflow } from "../workflows/binder";
import {
  GRIDS_WORKFLOW_CHANNELS,
  GridsWorkflowRunStatsWindowSchema,
  GridsWorkflowRunStatusSchema,
  type WorkflowCompletionItem,
  WorkflowDiagnosticSchema,
} from "../workflows/contracts";
import { gridsWorkflows } from "../workflows/module";
import {
  currentAccessSubject,
  currentCredentialPermission,
  currentResourceBoundBaseId,
  currentWorkflowPrincipal,
  gateAt,
  minPermission,
} from "./permissions";

export const WorkflowValidateSchema = z.object({ source: z.string().min(1).max(200_000) });

export const WorkflowValidateResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), plan: z.unknown() }),
  z.object({ ok: z.literal(false), diagnostics: z.array(WorkflowDiagnosticSchema) }),
]);

export const WorkflowRunDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export const WorkflowRunsQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  status: GridsWorkflowRunStatusSchema.optional(),
  mode: z.enum(["execute", "dryRun"]).optional(),
  channel: z.enum(GRIDS_WORKFLOW_CHANNELS).optional(),
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const WorkflowRunStatsQuerySchema = z.object({ window: GridsWorkflowRunStatsWindowSchema.optional() });

export const WorkflowEmailDeliveriesQuerySchema = WorkflowRunsQuerySchema.pick({
  workflowId: true,
  cursor: true,
  limit: true,
});

const LauncherInvocationBaseSchema = z.object({
  operationId: z.string().trim().min(1).max(120),
  mode: z.enum(["execute", "dryRun"]).default("execute"),
  expectedRevision: z.number().int().positive().optional(),
  inputs: z.record(z.string(), z.json()).default({}),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

export const ScannerLauncherRequestSchema = LauncherInvocationBaseSchema.extend({
  expectedRevision: z.number().int().positive(),
  scannedText: z.string().trim().min(1).max(4_096),
}).strict();

const BulkLauncherRecordIdsRequestSchema = LauncherInvocationBaseSchema.extend({
  recordIds: z.array(z.string().uuid()).min(1).max(10_000),
}).strict();

const BulkLauncherQueryRequestSchema = LauncherInvocationBaseSchema.extend({ query: RecordQuerySchema.strict() }).strict();

export const BulkLauncherRequestSchema = z.union([BulkLauncherRecordIdsRequestSchema, BulkLauncherQueryRequestSchema]);
export const DashboardLauncherRequestSchema = LauncherInvocationBaseSchema.strict();

export const canReadWorkflow = async (c: Context<AuthContext>, workflow: { baseId: string; id: string }): Promise<boolean> => {
  const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "read");
  return gate.ok;
};

const readableWorkflowIds = async (
  c: Context<AuthContext>,
  baseId: string,
  workflows: Array<{ id: string; baseId: string }>,
): Promise<Set<string>> => {
  const boundBaseId = currentResourceBoundBaseId(c);
  if (boundBaseId !== undefined && boundBaseId !== baseId) return new Set();
  const grants = await loadBaseWorkflowGrantsForSubject({ baseId, subject: currentAccessSubject(c) });
  const credentialLevel = currentCredentialPermission(c);
  return new Set(
    workflows
      .filter((workflow) => {
        const level = minPermission(resolveEffectivePermission(grants, { baseId, workflowId: workflow.id }), credentialLevel);
        return hasAtLeast(level, "read");
      })
      .map((workflow) => workflow.id),
  );
};

export const visibleWorkflowsForBase = async (c: Context<AuthContext>, baseId: string, options: { includeDeleted?: boolean } = {}) => {
  const workflows = await listWorkflows(baseId, false, options.includeDeleted);
  const visibleIds = await readableWorkflowIds(c, baseId, workflows);
  return workflows.filter((workflow) => visibleIds.has(workflow.id));
};

export const visibleWorkflowIdsForBase = async (
  c: Context<AuthContext>,
  baseId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<string[]> => {
  const workflows = await listWorkflowScopes(baseId, options.includeDeleted);
  return [...(await readableWorkflowIds(c, baseId, workflows))];
};

type WorkflowCatalogDeps = {
  listTablesByBase: typeof listTablesByBase;
  listTemplatesForTable: typeof listTemplatesForTable;
  listFieldsByTable: typeof listFieldsByTable;
  listEmailTemplatesForBase: typeof listEmailTemplatesForBase;
};

const workflowCatalogDeps: WorkflowCatalogDeps = {
  listTablesByBase,
  listTemplatesForTable,
  listFieldsByTable,
  listEmailTemplatesForBase,
};

export const permissionedWorkflowCatalog = async (
  c: Context<AuthContext>,
  baseId: string,
  deps: WorkflowCatalogDeps = workflowCatalogDeps,
): Promise<WorkflowCatalog> => {
  const visibleTables = [];
  const fieldsByTable = new Map<string, Array<{ id: string; shortId: string; name: string }>>();
  const templates = [];
  const emailTemplates = [];
  for (const table of await deps.listTablesByBase(baseId)) {
    const tableGate = await gateAt(c, { baseId, tableId: table.id }, "read");
    let hasVisibleTemplate = false;
    for (const template of await deps.listTemplatesForTable(table.id)) {
      const templateGate = await gateAt(c, { baseId, tableId: table.id, documentTemplateId: template.id }, "read");
      if (templateGate.ok) {
        hasVisibleTemplate = true;
        templates.push({ id: template.id, shortId: template.shortId, name: template.name, tableId: template.tableId });
      }
    }
    if (!tableGate.ok && !hasVisibleTemplate) continue;
    visibleTables.push({ id: table.id, shortId: table.shortId, name: table.name });
    if (tableGate.ok) {
      const fields = await deps.listFieldsByTable(table.id);
      fieldsByTable.set(
        table.id,
        fields.filter((field) => !field.deletedAt).map((field) => ({ id: field.id, shortId: field.shortId, name: field.name })),
      );
    }
  }
  const emailTemplateGate = await gateAt(c, { baseId }, "admin");
  if (emailTemplateGate.ok) {
    for (const template of await deps.listEmailTemplatesForBase(baseId)) {
      if (template.enabled) emailTemplates.push({ id: template.id, shortId: template.shortId, name: template.name });
    }
  }
  return buildWorkflowCatalog({ tables: visibleTables, fieldsByTable, templates, emailTemplates });
};

export const validatePermissionedWorkflowSource = async (
  c: Context<AuthContext>,
  baseId: string,
  source: string,
  catalog?: WorkflowCatalog,
) => {
  const compiled = await compileWorkflow(source, gridsWorkflows);
  if (!compiled.ok) return compiled;
  return bindGridsWorkflow(compiled.ir, catalog ?? (await permissionedWorkflowCatalog(c, baseId)));
};

const uniqueEntries = <T extends WorkflowCatalogEntry>(index: { refs: Map<string, T> }): T[] =>
  [...new Map([...index.refs.values()].map((entry) => [entry.id, entry])).values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );

export const buildWorkflowCompletions = (source: string, caret: number, catalog: WorkflowCatalog): WorkflowCompletionItem[] => {
  const context = workflowCompletionContext(source, caret);

  if (context.key === "table") {
    return uniqueEntries(catalog.tables).map((entry) =>
      workflowCompletionItem(context, "source", entry.name, entry.name, `Table ${entry.shortId}`),
    );
  }
  if (context.key === "field") {
    const fields = [...catalog.fieldsByTable.values()].flatMap(uniqueEntries);
    return [...new Map(fields.map((entry) => [entry.id, entry])).values()].map((entry) =>
      workflowCompletionItem(context, "field", entry.name, entry.name, `Field ${entry.shortId}`),
    );
  }
  if (context.key === "template") {
    return [
      ...uniqueEntries(catalog.templates).map((entry) =>
        workflowCompletionItem(context, "source", entry.name, entry.name, "Document template"),
      ),
      ...uniqueEntries(catalog.emailTemplates).map((entry) =>
        workflowCompletionItem(context, "source", entry.name, entry.name, "Email template"),
      ),
    ];
  }
  return buildWorkflowManifestCompletions(source, caret, gridsWorkflows);
};

export const baseExists = async (baseId: string): Promise<boolean> => Boolean(await getBase(baseId));

export const workflowPrincipal = (c: Context<AuthContext>) => {
  return currentWorkflowPrincipal(c);
};
