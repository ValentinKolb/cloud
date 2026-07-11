import type { AuthContext } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import { z } from "zod";
import {
  RecordQuerySchema,
  WorkflowRunStatsWindowSchema,
  WorkflowRunStatusSchema,
  WorkflowStepRunSchema,
  WorkflowTriggerKindSchema,
} from "../contracts";
import { gridsService } from "../service";
import { buildWorkflowCatalog } from "../service/workflows";
import { currentActorViewer, gateAt } from "./permissions";

export const WorkflowValidateSchema = z.object({
  source: z.string().min(1).max(200_000),
});

export const WorkflowScannerRunSchema = z.object({
  code: z.string().trim().min(1).max(500),
});

export const WorkflowGenericRunSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional().default({}),
});

export const WorkflowBulkRunSchema = z
  .object({
    input: z.string().trim().min(1).max(120).optional(),
    recordIds: z.array(z.string().uuid()).min(1).max(10_000).optional(),
    query: RecordQuerySchema.optional(),
  })
  .refine((value) => (value.recordIds === undefined) !== (value.query === undefined), {
    message: "Provide either recordIds or query",
  });

const WorkflowDiagnosticSchema = z.object({
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
});

export const WorkflowValidateResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), definition: z.unknown() }),
  z.object({ ok: z.literal(false), diagnostics: z.array(WorkflowDiagnosticSchema) }),
]);

export const WorkflowStepRunListSchema = z.object({
  items: z.array(WorkflowStepRunSchema),
});

export const WorkflowRunDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export const WorkflowRunsQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  status: WorkflowRunStatusSchema.optional(),
  trigger: WorkflowTriggerKindSchema.optional(),
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const WorkflowRunStatsQuerySchema = z.object({
  window: WorkflowRunStatsWindowSchema.optional(),
});

export const WorkflowEmailDeliveriesQuerySchema = WorkflowRunsQuerySchema.pick({
  workflowId: true,
  cursor: true,
  limit: true,
});

export const canReadWorkflow = async (c: Context<AuthContext>, workflow: { baseId: string; id: string }): Promise<boolean> => {
  const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "read");
  return gate.ok;
};

export const visibleWorkflowsForBase = async (c: Context<AuthContext>, baseId: string) => {
  const visible = [];
  for (const workflow of await gridsService.workflow.listForBase(baseId)) {
    if (await canReadWorkflow(c, workflow)) visible.push(workflow);
  }
  return visible;
};

export const permissionedWorkflowCatalog = async (c: Context<AuthContext>, baseId: string) => {
  const visibleTables = [];
  const fieldsByTable = new Map<string, Array<{ id: string; shortId: string; name: string }>>();
  const templates = [];
  const emailTemplates = [];
  for (const table of await gridsService.table.listByBase(baseId)) {
    const tableGate = await gateAt(c, { baseId, tableId: table.id }, "read");
    let hasVisibleTemplate = false;
    for (const template of await gridsService.document.listTemplatesForTable(table.id)) {
      const templateGate = await gateAt(c, { baseId, tableId: table.id, documentTemplateId: template.id }, "read");
      if (templateGate.ok) {
        hasVisibleTemplate = true;
        templates.push({ id: template.id, shortId: template.shortId, name: template.name, tableId: template.tableId });
      }
    }
    if (!tableGate.ok && !hasVisibleTemplate) continue;
    visibleTables.push({ id: table.id, shortId: table.shortId, name: table.name });
    if (tableGate.ok) {
      const fields = await gridsService.field.listByTable(table.id);
      fieldsByTable.set(
        table.id,
        fields.filter((field) => !field.deletedAt).map((field) => ({ id: field.id, shortId: field.shortId, name: field.name })),
      );
    }
  }
  const emailTemplateGate = await gateAt(c, { baseId }, "admin");
  if (emailTemplateGate.ok) {
    for (const template of await gridsService.emailTemplate.listForBase(baseId)) {
      if (template.enabled) emailTemplates.push({ id: template.id, shortId: template.shortId, name: template.name });
    }
  }
  return buildWorkflowCatalog({ tables: visibleTables, fieldsByTable, templates, emailTemplates });
};

export const workflowActor = (c: Context<AuthContext>) => {
  const viewer = currentActorViewer(c);
  return {
    actorUserId: viewer.userId,
    actorGroupIds: viewer.userGroups,
    serviceAccountId: viewer.serviceAccountId,
  };
};
