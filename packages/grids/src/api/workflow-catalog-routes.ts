import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  CreateWorkflowSchema,
  UpdateWorkflowSchema,
  WorkflowAutocompleteBodySchema,
  WorkflowAutocompleteResponseSchema,
  WorkflowListSchema,
  WorkflowSchema,
} from "../contracts";
import { gridsService } from "../service";
import { parseWorkflowYaml } from "../workflows/dsl";
import { buildWorkflowIntelligence, workflowDiagnostics } from "../workflows/intelligence";
import { currentActorUserId, gateAt } from "./permissions";
import {
  canReadWorkflow,
  permissionedWorkflowCatalog,
  visibleWorkflowsForBase,
  WorkflowValidateResponseSchema,
  WorkflowValidateSchema,
} from "./workflow-api-shared";

export const createWorkflowCatalogRoutes = (workflowTriggerRuntime: typeof gridsService.workflowTriggerRuntime) =>
  new Hono<AuthContext>()
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
        const result = await gridsService.workflow.create(baseId, c.req.valid("json"), currentActorUserId(c));
        if (result.ok) await workflowTriggerRuntime.sync(result.data);
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
        const result = await gridsService.workflow.update(workflowId, c.req.valid("json"), currentActorUserId(c));
        if (result.ok) await workflowTriggerRuntime.sync(result.data);
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
        const result = await gridsService.workflow.remove(workflowId, currentActorUserId(c));
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        await workflowTriggerRuntime.delete(workflowId);
        return c.body(null, 204);
      },
    );
