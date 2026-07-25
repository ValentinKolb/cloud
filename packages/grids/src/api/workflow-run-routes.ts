import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { DocumentRunSummaryListSchema } from "../contracts";
import { listRunsForWorkflowRun, renderWorkflowRunPdf } from "../service/documents";
import { getWorkflow } from "../service/workflow-definitions";
import {
  getWorkflowRunStats,
  listWorkflowEmailDeliveriesPage,
  listWorkflowRunsPage,
  listWorkflowStepRunsPage,
} from "../service/workflow-kernel-observability";
import { cancelWorkflowRun, getWorkflowRun } from "../service/workflow-kernel-runs";
import {
  GridsWorkflowEmailDeliveryListSchema,
  GridsWorkflowRunListSchema,
  GridsWorkflowRunSchema,
  GridsWorkflowRunStatsSchema,
  GridsWorkflowStepRunListSchema,
} from "../workflows/contracts";
import { encodeHeaderValue, pdfResponse } from "./download-response";
import { currentActorUserId, gateAt } from "./permissions";
import { uuidParam } from "./route-params";
import {
  baseExists,
  visibleWorkflowIdsForBase,
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

const canReadDocumentRun =
  (c: Parameters<typeof gateAt>[0]) => async (run: { baseId: string; tableId: string; templateId: string | null }) =>
    (
      await gateAt(
        c,
        run.templateId
          ? { baseId: run.baseId, tableId: run.tableId, documentTemplateId: run.templateId }
          : { baseId: run.baseId, tableId: run.tableId },
        "read",
      )
    ).ok;

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
        const visibleIds = await visibleWorkflowIdsForBase(c, baseId, { includeDeleted: true });
        if (visibleIds.length === 0) {
          const gate = await gateAt(c, { baseId }, "read");
          if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        }
        const query = c.req.valid("query");
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
        const visibleIds = await visibleWorkflowIdsForBase(c, baseId, { includeDeleted: true });
        if (visibleIds.length === 0) {
          const gate = await gateAt(c, { baseId }, "read");
          if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        }
        return c.json(await getWorkflowRunStats(baseId, visibleIds, { window: c.req.valid("query").window }));
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
        const visibleIds = await visibleWorkflowIdsForBase(c, baseId, { includeDeleted: true });
        if (visibleIds.length === 0) {
          const gate = await gateAt(c, { baseId }, "read");
          if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        }
        const query = c.req.valid("query");
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
    .post(
      "/runs/:runId/cancel",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Cancel an active workflow run",
        responses: {
          200: jsonResponse(GridsWorkflowRunSchema, "Canceled workflow run"),
          400: jsonResponse(ErrorResponseSchema, "Invalid workflow run id or run is already terminal"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Invalid workflow run id" }, 400);
        const run = await getWorkflowRun(runId);
        if (!run?.workflowId) return c.json({ message: "Workflow run not found" }, 404);
        const workflow = await getWorkflow(run.workflowId, true);
        if (!workflow) return c.json({ message: "Workflow run not found" }, 404);
        const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const canceled = await cancelWorkflowRun(runId, currentActorUserId(c));
        if (!canceled) return c.json({ message: "Only queued, running, or waiting runs can be canceled." }, 400);
        return c.json(canceled);
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
        return c.json(await listWorkflowStepRunsPage(runId));
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
        return c.json(await listRunsForWorkflowRun(runId, c.req.valid("query"), canReadDocumentRun(c)));
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
        const pdf = await renderWorkflowRunPdf(runId, canReadDocumentRun(c));
        if (!pdf.ok) return c.json({ message: pdf.error.message }, pdf.error.status);
        return pdfResponse(pdf.data.pdf, pdf.data.filename, {
          "X-Grids-Document-Count": String(pdf.data.documentCount),
          "X-Grids-Document-Filename": encodeHeaderValue(pdf.data.filename),
        });
      },
    );
