import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  CreateWorkflowSchema,
  DocumentRunSummaryListSchema,
  RecordQuerySchema,
  UpdateWorkflowSchema,
  WorkflowAutocompleteBodySchema,
  WorkflowAutocompleteResponseSchema,
  WorkflowEmailDeliveryListSchema,
  WorkflowListSchema,
  WorkflowRunListSchema,
  WorkflowRunSchema,
  WorkflowRunStatsSchema,
  WorkflowRunStatusSchema,
  WorkflowSchema,
  WorkflowStepRunSchema,
} from "../contracts";
import { gridsService } from "../service";
import { buildWorkflowCatalog } from "../service/workflows";
import { parseWorkflowYaml } from "../workflows/dsl";
import { buildWorkflowIntelligence, workflowDiagnostics } from "../workflows/intelligence";
import { encodeHeaderValue, pdfResponse } from "./download-response";
import { gateAt } from "./permissions";

const WorkflowValidateSchema = z.object({
  source: z.string().min(1).max(200_000),
});

const WorkflowScannerRunSchema = z.object({
  code: z.string().trim().min(1).max(500),
});

const WorkflowGenericRunSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional().default({}),
});

const WorkflowBulkRunSchema = z
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

const WorkflowValidateResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    definition: z.unknown(),
  }),
  z.object({
    ok: z.literal(false),
    diagnostics: z.array(WorkflowDiagnosticSchema),
  }),
]);

const WorkflowStepRunListSchema = z.object({
  items: z.array(WorkflowStepRunSchema),
});

const WorkflowRunDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const WorkflowRunsQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  status: WorkflowRunStatusSchema.optional(),
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const WorkflowEmailDeliveriesQuerySchema = WorkflowRunsQuerySchema.pick({
  workflowId: true,
  cursor: true,
  limit: true,
});

const canReadWorkflow = async (c: Parameters<typeof gateAt>[0], workflow: { baseId: string; id: string }): Promise<boolean> => {
  const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "read");
  return gate.ok;
};

const visibleWorkflowsForBase = async (c: Parameters<typeof gateAt>[0], baseId: string) => {
  const workflows = await gridsService.workflow.listForBase(baseId);
  const visible = [];
  for (const workflow of workflows) {
    if (await canReadWorkflow(c, workflow)) visible.push(workflow);
  }
  return visible;
};

const permissionedWorkflowCatalog = async (c: Parameters<typeof gateAt>[0], baseId: string) => {
  const tables = await gridsService.table.listByBase(baseId);
  const visibleTables = [];
  const fieldsByTable = new Map<string, Array<{ id: string; shortId: string; name: string }>>();
  const templates = [];
  const emailTemplates = [];
  for (const table of tables) {
    const tableGate = await gateAt(c, { baseId, tableId: table.id }, "read");
    if (!tableGate.ok) continue;
    visibleTables.push({ id: table.id, shortId: table.shortId, name: table.name });
    const fields = await gridsService.field.listByTable(table.id);
    fieldsByTable.set(
      table.id,
      fields.filter((field) => !field.deletedAt).map((field) => ({ id: field.id, shortId: field.shortId, name: field.name })),
    );
    for (const template of await gridsService.document.listTemplatesForTable(table.id)) {
      const templateGate = await gateAt(c, { baseId, tableId: table.id, documentTemplateId: template.id }, "read");
      if (templateGate.ok) templates.push({ id: template.id, shortId: template.shortId, name: template.name, tableId: template.tableId });
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

const workflowActor = (c: Parameters<typeof gateAt>[0]) => {
  const actor = c.get("actor");
  const user = actor.kind === "user" ? actor.user : actor.delegatedUser;
  return {
    actorUserId: user?.id ?? null,
    actorGroupIds: user?.memberofGroupIds ?? [],
    serviceAccountId: actor.kind === "service_account" ? actor.serviceAccount.id : null,
  };
};

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .post(
    "/by-base/:baseId/validate",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Validate workflow YAML",
      responses: {
        200: jsonResponse(WorkflowValidateResponseSchema, "Validation result"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", WorkflowValidateSchema),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const gate = await gateAt(c, { baseId }, "read");
      if (!gate.ok && (await visibleWorkflowsForBase(c, baseId)).length === 0) return respond(c, () => Promise.resolve(gate));
      const result = parseWorkflowYaml(c.req.valid("json").source);
      return c.json(result.ok ? { ok: true as const, definition: result.definition } : result);
    },
  )

  .post(
    "/by-base/:baseId/autocomplete",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Return permission-safe workflow YAML autocomplete items and diagnostics",
      responses: {
        200: jsonResponse(WorkflowAutocompleteResponseSchema, "Workflow autocomplete items and diagnostics"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", WorkflowAutocompleteBodySchema),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const gate = await gateAt(c, { baseId }, "read");
      if (!gate.ok && (await visibleWorkflowsForBase(c, baseId)).length === 0) return respond(c, () => Promise.resolve(gate));

      const body = c.req.valid("json");
      const catalog = await permissionedWorkflowCatalog(c, baseId);
      const caret = body.caret ?? body.source.length;
      const diagnostics = workflowDiagnostics(body.source, catalog).map((diagnostic) => ({
        message: diagnostic.message,
        ...(diagnostic.line ? { line: diagnostic.line } : {}),
        ...(diagnostic.column ? { column: diagnostic.column } : {}),
      }));
      const items = buildWorkflowIntelligence({ source: body.source, caret, catalog });
      return c.json({ ok: true as const, diagnostics, items });
    },
  )

  .get(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "List workflows visible on a base",
      responses: {
        200: jsonResponse(WorkflowListSchema, "Workflows"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const visible = await visibleWorkflowsForBase(c, baseId);
      if (visible.length === 0) {
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      }
      return c.json(visible);
    },
  )

  .get(
    "/by-base/:baseId/runs",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "List workflow runs visible on a base",
      responses: {
        200: jsonResponse(WorkflowRunListSchema, "Workflow runs"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("query", WorkflowRunsQuerySchema),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const visible = await visibleWorkflowsForBase(c, baseId);
      if (visible.length === 0) {
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      }
      const query = c.req.valid("query");
      const visibleIds = visible.map((workflow) => workflow.id);
      if (query.workflowId && !visibleIds.includes(query.workflowId)) return c.json({ message: "Workflow not found" }, 404);
      return c.json(
        await gridsService.workflow.listRunsPage({
          baseId,
          workflowIds: visibleIds,
          workflowId: query.workflowId,
          status: query.status,
          cursor: query.cursor,
          limit: query.limit,
        }),
      );
    },
  )

  .get(
    "/by-base/:baseId/run-stats",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Return workflow run stats visible on a base",
      responses: {
        200: jsonResponse(WorkflowRunStatsSchema, "Workflow run stats"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const visible = await visibleWorkflowsForBase(c, baseId);
      if (visible.length === 0) {
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      }
      return c.json(
        await gridsService.workflow.runStats(
          baseId,
          visible.map((workflow) => workflow.id),
        ),
      );
    },
  )

  .get(
    "/by-base/:baseId/email-deliveries",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "List workflow email deliveries visible on a base",
      responses: {
        200: jsonResponse(WorkflowEmailDeliveryListSchema, "Workflow email deliveries"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("query", WorkflowEmailDeliveriesQuerySchema),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const visible = await visibleWorkflowsForBase(c, baseId);
      if (visible.length === 0) {
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      }
      const query = c.req.valid("query");
      const visibleIds = visible.map((workflow) => workflow.id);
      if (query.workflowId && !visibleIds.includes(query.workflowId)) return c.json({ message: "Workflow not found" }, 404);
      return c.json(
        await gridsService.workflow.listEmailDeliveriesPage({
          baseId,
          workflowIds: visibleIds,
          workflowId: query.workflowId,
          cursor: query.cursor,
          limit: query.limit,
        }),
      );
    },
  )

  .post(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Create a workflow",
      responses: {
        201: jsonResponse(WorkflowSchema, "Created"),
        400: jsonResponse(ErrorResponseSchema, "Invalid workflow"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", CreateWorkflowSchema),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.workflow.create(baseId, c.req.valid("json"), user.id);
      if (result.ok) await gridsService.workflowTriggerRuntime.sync(result.data);
      return respond(c, () => Promise.resolve(result), 201);
    },
  )

  .get(
    "/:workflowId",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Get a workflow",
      responses: {
        200: jsonResponse(WorkflowSchema, "Workflow"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const workflowId = c.req.param("workflowId")!;
      const workflow = await gridsService.workflow.get(workflowId);
      if (!workflow || !(await canReadWorkflow(c, workflow))) return c.json({ message: "Workflow not found" }, 404);
      return c.json(workflow);
    },
  )

  .patch(
    "/:workflowId",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Update a workflow",
      responses: {
        200: jsonResponse(WorkflowSchema, "Updated"),
        400: jsonResponse(ErrorResponseSchema, "Invalid workflow"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", UpdateWorkflowSchema),
    async (c) => {
      const workflowId = c.req.param("workflowId")!;
      const workflow = await gridsService.workflow.get(workflowId);
      if (!workflow) return c.json({ message: "Workflow not found" }, 404);
      const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.workflow.update(workflowId, c.req.valid("json"), user.id);
      if (result.ok) await gridsService.workflowTriggerRuntime.sync(result.data);
      return respond(c, () => Promise.resolve(result));
    },
  )

  .delete(
    "/:workflowId",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Delete a workflow",
      responses: {
        204: { description: "Deleted" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const workflowId = c.req.param("workflowId")!;
      const workflow = await gridsService.workflow.get(workflowId);
      if (!workflow) return c.json({ message: "Workflow not found" }, 404);
      const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.workflow.remove(workflowId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      await gridsService.workflowTriggerRuntime.delete(workflowId);
      return c.body(null, 204);
    },
  )

  .get(
    "/:workflowId/runs",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "List workflow runs",
      responses: {
        200: jsonResponse(WorkflowRunListSchema, "Runs"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("query", WorkflowRunsQuerySchema.pick({ cursor: true, limit: true, status: true })),
    async (c) => {
      const workflowId = c.req.param("workflowId")!;
      const workflow = await gridsService.workflow.get(workflowId);
      if (!workflow) return c.json({ message: "Workflow not found" }, 404);
      const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const query = c.req.valid("query");
      return c.json(
        await gridsService.workflow.listRunsPage({
          baseId: workflow.baseId,
          workflowIds: [workflow.id],
          workflowId,
          status: query.status,
          cursor: query.cursor,
          limit: query.limit,
        }),
      );
    },
  )

  .post(
    "/:workflowId/run/form",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Run a workflow from form input",
      responses: {
        200: jsonResponse(WorkflowRunSchema, "Run"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", WorkflowGenericRunSchema),
    async (c) =>
      respond(c, () =>
        gridsService.workflow.execute({
          workflowId: c.req.param("workflowId")!,
          triggerKind: "form",
          triggerInput: c.req.valid("json").input,
          ...workflowActor(c),
        }),
      ),
  )

  .post(
    "/:workflowId/run/api",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Run a workflow from API input",
      responses: {
        200: jsonResponse(WorkflowRunSchema, "Run"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", WorkflowGenericRunSchema),
    async (c) =>
      respond(c, () =>
        gridsService.workflow.execute({
          workflowId: c.req.param("workflowId")!,
          triggerKind: "api",
          triggerInput: c.req.valid("json").input,
          ...workflowActor(c),
        }),
      ),
  )

  .post(
    "/:workflowId/run/dashboard-button",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Run a workflow from a dashboard button",
      responses: {
        200: jsonResponse(WorkflowRunSchema, "Run"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", WorkflowGenericRunSchema),
    async (c) =>
      respond(c, () =>
        gridsService.workflow.execute({
          workflowId: c.req.param("workflowId")!,
          triggerKind: "dashboardButton",
          triggerInput: c.req.valid("json").input,
          ...workflowActor(c),
        }),
      ),
  )

  .post(
    "/:workflowId/run/bulk-selection",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Run a workflow from selected records or a record query",
      responses: {
        200: jsonResponse(WorkflowRunSchema, "Run"),
        400: jsonResponse(ErrorResponseSchema, "Invalid bulk selection"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", WorkflowBulkRunSchema),
    async (c) => {
      const body = c.req.valid("json");
      return respond(c, () =>
        gridsService.workflowTriggerRuntime.queueBulkSelection({
          workflowId: c.req.param("workflowId")!,
          inputName: body.input,
          recordIds: body.recordIds,
          query: body.query,
          ...workflowActor(c),
        }),
      );
    },
  )

  .post(
    "/:workflowId/run/scanner",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Run a workflow from scanner input",
      responses: {
        200: jsonResponse(WorkflowRunSchema, "Run"),
        400: jsonResponse(ErrorResponseSchema, "Invalid scanner input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", WorkflowScannerRunSchema),
    async (c) => {
      return respond(c, () =>
        gridsService.workflow.executeScanner({
          workflowId: c.req.param("workflowId")!,
          scannedText: c.req.valid("json").code,
          ...workflowActor(c),
        }),
      );
    },
  )

  .get(
    "/runs/:runId",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Get a workflow run",
      responses: {
        200: jsonResponse(WorkflowRunSchema, "Workflow run"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const runId = c.req.param("runId")!;
      const run = await gridsService.workflow.getRun(runId);
      if (!run || !run.workflowId) return c.json({ message: "Workflow run not found" }, 404);
      const workflow = await gridsService.workflow.get(run.workflowId);
      if (!workflow) return c.json({ message: "Workflow run not found" }, 404);
      const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(run);
    },
  )

  .get(
    "/runs/:runId/steps",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "List workflow run steps",
      responses: {
        200: jsonResponse(WorkflowStepRunListSchema, "Steps"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const runId = c.req.param("runId")!;
      const run = await gridsService.workflow.getRun(runId);
      if (!run || !run.workflowId) return c.json({ message: "Workflow run not found" }, 404);
      const workflow = await gridsService.workflow.get(run.workflowId);
      if (!workflow) return c.json({ message: "Workflow run not found" }, 404);
      const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json({ items: await gridsService.workflow.listStepRuns(runId) });
    },
  )

  .get(
    "/runs/:runId/documents",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "List documents generated by a workflow run",
      responses: {
        200: jsonResponse(DocumentRunSummaryListSchema, "Generated documents"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("query", WorkflowRunDocumentsQuerySchema),
    async (c) => {
      const runId = c.req.param("runId")!;
      const run = await gridsService.workflow.getRun(runId);
      if (!run || !run.workflowId) return c.json({ message: "Workflow run not found" }, 404);
      const workflow = await gridsService.workflow.get(run.workflowId);
      if (!workflow) return c.json({ message: "Workflow run not found" }, 404);
      const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(await gridsService.document.listRunsForWorkflowRun(runId, c.req.valid("query")));
    },
  )

  .get(
    "/runs/:runId/documents/download",
    describeRoute({
      tags: ["Grids:Workflow"],
      summary: "Download all documents generated by a workflow run as one PDF",
      responses: {
        200: { description: "Combined generated PDF" },
        400: jsonResponse(ErrorResponseSchema, "No generated documents or too many documents"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const runId = c.req.param("runId")!;
      const run = await gridsService.workflow.getRun(runId);
      if (!run || !run.workflowId) return c.json({ message: "Workflow run not found" }, 404);
      const workflow = await gridsService.workflow.get(run.workflowId);
      if (!workflow) return c.json({ message: "Workflow run not found" }, 404);
      const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const pdf = await gridsService.document.renderWorkflowRunPdf(runId);
      if (!pdf.ok) return c.json({ message: pdf.error.message }, pdf.error.status);
      return pdfResponse(pdf.data.pdf, pdf.data.filename, {
        "X-Grids-Document-Count": String(pdf.data.documentCount),
        "X-Grids-Document-Filename": encodeHeaderValue(pdf.data.filename),
      });
    },
  );

export default app;
