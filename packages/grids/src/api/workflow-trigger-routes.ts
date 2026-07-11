import { ErrorResponseSchema, MessageResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { WorkflowRunSchema } from "../contracts";
import { gridsService } from "../service";
import { gateAt } from "./permissions";
import { WorkflowBulkRunSchema, WorkflowGenericRunSchema, WorkflowScannerRunSchema, workflowActor } from "./workflow-api-shared";

export const createWorkflowTriggerRoutes = (workflowTriggerRuntime: typeof gridsService.workflowTriggerRuntime) =>
  new Hono<AuthContext>()
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
          workflowTriggerRuntime.queueDirectRun({
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
          workflowTriggerRuntime.queueDirectRun({
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
          workflowTriggerRuntime.queueDirectRun({
            workflowId: c.req.param("workflowId")!,
            triggerKind: "dashboardButton",
            triggerInput: c.req.valid("json").input,
            ...workflowActor(c),
          }),
        ),
    )

    .post(
      "/:workflowId/run/schedule",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Run a scheduled workflow immediately",
        responses: {
          200: jsonResponse(MessageResponseSchema, "Run requested"),
          400: jsonResponse(ErrorResponseSchema, "Invalid schedule trigger"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const workflowId = c.req.param("workflowId")!;
        const workflow = await gridsService.workflow.get(workflowId);
        if (!workflow) return c.json({ message: "Workflow not found" }, 404);
        const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return respond(c, async () => {
          const result = await workflowTriggerRuntime.runScheduledNow(workflowId);
          if (!result.ok) return result;
          return { ok: true, data: { message: "Scheduled workflow run requested." } };
        });
      },
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
          workflowTriggerRuntime.queueBulkSelection({
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
          workflowTriggerRuntime.queueScanner({
            workflowId: c.req.param("workflowId")!,
            scannedText: c.req.valid("json").code,
            ...workflowActor(c),
          }),
        );
      },
    );
