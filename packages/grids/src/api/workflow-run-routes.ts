import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { DocumentRunSummaryListSchema } from "../contracts";
import { listRunsForWorkflowRun, renderWorkflowRunPdf } from "../service/documents";
import {
  getWorkflowRunStats,
  listWorkflowEmailDeliveriesPage,
  listWorkflowRunsPage,
  listWorkflowStepRuns,
} from "../service/workflow-kernel-observability";
import { getWorkflowRun } from "../service/workflow-kernel-runs";
import { getWorkflow } from "../service/workflow-kernel-store";
import {
  GridsWorkflowEmailDeliveryListSchema,
  GridsWorkflowRunListSchema,
  GridsWorkflowRunSchema,
  GridsWorkflowRunStatsSchema,
  GridsWorkflowStepRunListSchema,
} from "../workflows/contracts";
import { encodeHeaderValue, pdfResponse } from "./download-response";
import { gateAt } from "./permissions";
import { uuidParam } from "./route-params";
import {
  baseExists,
  visibleWorkflowsForBase,
  WorkflowEmailDeliveriesQuerySchema,
  WorkflowRunDocumentsQuerySchema,
  WorkflowRunStatsQuerySchema,
  WorkflowRunsQuerySchema,
} from "./workflow-api-shared";

const loadReadableRun = async (c: Parameters<typeof gateAt>[0], runId: string) => {
  const run = await getWorkflowRun(runId);
  if (!run?.workflowId) return null;
  const workflow = await getWorkflow(run.workflowId, true);
  if (!workflow) return null;
  const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "read");
  return gate.ok ? { run, workflow } : gate;
};

export const createWorkflowRunRoutes = () =>
  new Hono<AuthContext>()
    .get(
      "/by-base/:baseId/runs",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "List workflow runs visible on a base",
        responses: {
          200: jsonResponse(GridsWorkflowRunListSchema, "Workflow runs"),
          400: jsonResponse(ErrorResponseSchema, "Invalid base id or query"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("query", WorkflowRunsQuerySchema),
      async (c) => {
        const baseId = uuidParam(c, "baseId");
        if (!baseId) return c.json({ message: "Invalid base id" }, 400);
        if (!(await baseExists(baseId))) return c.json({ message: "Base not found" }, 404);
        const visible = await visibleWorkflowsForBase(c, baseId, { includeDeleted: true });
        if (visible.length === 0) {
          const gate = await gateAt(c, { baseId }, "read");
          if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        }
        const query = c.req.valid("query");
        const visibleIds = visible.map((workflow) => workflow.id);
        if (query.workflowId && !visibleIds.includes(query.workflowId)) return c.json({ message: "Workflow not found" }, 404);
        return c.json(
          await listWorkflowRunsPage({
            baseId,
            workflowIds: visibleIds,
            workflowId: query.workflowId,
            status: query.status,
            mode: query.mode,
            channel: query.channel,
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
          200: jsonResponse(GridsWorkflowRunStatsSchema, "Workflow run stats"),
          400: jsonResponse(ErrorResponseSchema, "Invalid base id or query"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("query", WorkflowRunStatsQuerySchema),
      async (c) => {
        const baseId = uuidParam(c, "baseId");
        if (!baseId) return c.json({ message: "Invalid base id" }, 400);
        if (!(await baseExists(baseId))) return c.json({ message: "Base not found" }, 404);
        const visible = await visibleWorkflowsForBase(c, baseId, { includeDeleted: true });
        if (visible.length === 0) {
          const gate = await gateAt(c, { baseId }, "read");
          if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        }
        return c.json(
          await getWorkflowRunStats(
            baseId,
            visible.map((workflow) => workflow.id),
            { window: c.req.valid("query").window },
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
          200: jsonResponse(GridsWorkflowEmailDeliveryListSchema, "Workflow email deliveries"),
          400: jsonResponse(ErrorResponseSchema, "Invalid base id or query"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("query", WorkflowEmailDeliveriesQuerySchema),
      async (c) => {
        const baseId = uuidParam(c, "baseId");
        if (!baseId) return c.json({ message: "Invalid base id" }, 400);
        if (!(await baseExists(baseId))) return c.json({ message: "Base not found" }, 404);
        const visible = await visibleWorkflowsForBase(c, baseId, { includeDeleted: true });
        if (visible.length === 0) {
          const gate = await gateAt(c, { baseId }, "read");
          if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        }
        const query = c.req.valid("query");
        const visibleIds = visible.map((workflow) => workflow.id);
        if (query.workflowId && !visibleIds.includes(query.workflowId)) return c.json({ message: "Workflow not found" }, 404);
        return c.json(
          await listWorkflowEmailDeliveriesPage({
            baseId,
            workflowIds: visibleIds,
            workflowId: query.workflowId,
            cursor: query.cursor,
            limit: query.limit,
          }),
        );
      },
    )
    .get(
      "/:workflowId/runs",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "List workflow runs",
        responses: {
          200: jsonResponse(GridsWorkflowRunListSchema, "Runs"),
          400: jsonResponse(ErrorResponseSchema, "Invalid workflow id or query"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("query", WorkflowRunsQuerySchema.pick({ cursor: true, limit: true, status: true, mode: true, channel: true })),
      async (c) => {
        const workflowId = uuidParam(c, "workflowId");
        if (!workflowId) return c.json({ message: "Invalid workflow id" }, 400);
        const workflow = await getWorkflow(workflowId, true);
        if (!workflow) return c.json({ message: "Workflow not found" }, 404);
        const gate = await gateAt(c, { baseId: workflow.baseId, workflowId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const query = c.req.valid("query");
        return c.json(
          await listWorkflowRunsPage({
            baseId: workflow.baseId,
            workflowIds: [workflow.id],
            workflowId,
            status: query.status,
            mode: query.mode,
            channel: query.channel,
            cursor: query.cursor,
            limit: query.limit,
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
          200: jsonResponse(GridsWorkflowRunSchema, "Workflow run"),
          400: jsonResponse(ErrorResponseSchema, "Invalid workflow run id"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Invalid workflow run id" }, 400);
        const loaded = await loadReadableRun(c, runId);
        if (!loaded) return c.json({ message: "Workflow run not found" }, 404);
        if (!("run" in loaded)) return respond(c, () => Promise.resolve(loaded));
        return c.json(loaded.run);
      },
    )
    .get(
      "/runs/:runId/steps",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "List workflow run steps",
        responses: {
          200: jsonResponse(GridsWorkflowStepRunListSchema, "Steps"),
          400: jsonResponse(ErrorResponseSchema, "Invalid workflow run id"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Invalid workflow run id" }, 400);
        const loaded = await loadReadableRun(c, runId);
        if (!loaded) return c.json({ message: "Workflow run not found" }, 404);
        if (!("run" in loaded)) return respond(c, () => Promise.resolve(loaded));
        return c.json({ items: await listWorkflowStepRuns(runId) });
      },
    )
    .get(
      "/runs/:runId/documents",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "List documents generated by a workflow run",
        responses: {
          200: jsonResponse(DocumentRunSummaryListSchema, "Generated documents"),
          400: jsonResponse(ErrorResponseSchema, "Invalid workflow run id or query"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("query", WorkflowRunDocumentsQuerySchema),
      async (c) => {
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Invalid workflow run id" }, 400);
        const loaded = await loadReadableRun(c, runId);
        if (!loaded) return c.json({ message: "Workflow run not found" }, 404);
        if (!("run" in loaded)) return respond(c, () => Promise.resolve(loaded));
        return c.json(await listRunsForWorkflowRun(runId, c.req.valid("query")));
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
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Invalid workflow run id" }, 400);
        const loaded = await loadReadableRun(c, runId);
        if (!loaded) return c.json({ message: "Workflow run not found" }, 404);
        if (!("run" in loaded)) return respond(c, () => Promise.resolve(loaded));
        const pdf = await renderWorkflowRunPdf(runId);
        if (!pdf.ok) return c.json({ message: pdf.error.message }, pdf.error.status);
        return pdfResponse(pdf.data.pdf, pdf.data.filename, {
          "X-Grids-Document-Count": String(pdf.data.documentCount),
          "X-Grids-Document-Filename": encodeHeaderValue(pdf.data.filename),
        });
      },
    );
