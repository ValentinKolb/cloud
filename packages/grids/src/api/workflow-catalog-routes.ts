import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { createWorkflow, getWorkflow, removeWorkflow, updateWorkflow } from "../service/workflow-kernel-store";
import { createLauncher, getLauncher, listLaunchers, removeLauncher, updateLauncher } from "../service/workflow-launchers";
import {
  CreateGridsWorkflowLauncherSchema,
  CreateGridsWorkflowSchema,
  GridsWorkflowLauncherListSchema,
  GridsWorkflowLauncherSchema,
  GridsWorkflowListSchema,
  GridsWorkflowSchema,
  UpdateGridsWorkflowLauncherSchema,
  UpdateGridsWorkflowSchema,
  WORKFLOW_REVISION_HEADER,
  WorkflowAutocompleteBodySchema,
  WorkflowAutocompleteResponseSchema,
} from "../workflows/contracts";
import { currentActorUserId, gateAt } from "./permissions";
import {
  baseExists,
  buildWorkflowCompletions,
  canReadWorkflow,
  permissionedWorkflowCatalog,
  validatePermissionedWorkflowSource,
  visibleWorkflowsForBase,
  WorkflowValidateResponseSchema,
  WorkflowValidateSchema,
} from "./workflow-api-shared";

const loadReadableLauncher = async (c: Parameters<typeof canReadWorkflow>[0], launcherId: string) => {
  const launcher = await getLauncher(launcherId);
  if (!launcher) return null;
  const workflow = await getWorkflow(launcher.workflowId);
  if (!workflow || !(await canReadWorkflow(c, workflow))) return null;
  return { launcher, workflow };
};

export const createWorkflowCatalogRoutes = () =>
  new Hono<AuthContext>()
    .post(
      "/by-base/:baseId/validate",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Compile and bind workflow YAML",
        responses: {
          200: jsonResponse(WorkflowValidateResponseSchema, "Validation result"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", WorkflowValidateSchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        if (!(await baseExists(baseId))) return c.json({ message: "Base not found" }, 404);
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok && (await visibleWorkflowsForBase(c, baseId)).length === 0) return respond(c, () => Promise.resolve(gate));
        const result = await validatePermissionedWorkflowSource(c, baseId, c.req.valid("json").source);
        return c.json(result.ok ? { ok: true as const, plan: result.plan } : result);
      },
    )
    .post(
      "/by-base/:baseId/autocomplete",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Return permission-safe workflow language completions and diagnostics",
        responses: {
          200: jsonResponse(WorkflowAutocompleteResponseSchema, "Workflow completions and diagnostics"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", WorkflowAutocompleteBodySchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        if (!(await baseExists(baseId))) return c.json({ message: "Base not found" }, 404);
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok && (await visibleWorkflowsForBase(c, baseId)).length === 0) return respond(c, () => Promise.resolve(gate));
        const body = c.req.valid("json");
        const catalog = await permissionedWorkflowCatalog(c, baseId);
        const validation = await validatePermissionedWorkflowSource(c, baseId, body.source, catalog);
        return c.json({
          ok: true as const,
          diagnostics: validation.ok ? [] : validation.diagnostics,
          items: buildWorkflowCompletions(body.source, body.caret ?? body.source.length, catalog),
        });
      },
    )
    .get(
      "/by-base/:baseId",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "List workflows visible on a base",
        responses: {
          200: jsonResponse(GridsWorkflowListSchema, "Workflows"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        if (!(await baseExists(baseId))) return c.json({ message: "Base not found" }, 404);
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
          201: jsonResponse(GridsWorkflowSchema, "Created"),
          400: jsonResponse(ErrorResponseSchema, "Invalid workflow"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", CreateGridsWorkflowSchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        if (!(await baseExists(baseId))) return c.json({ message: "Base not found" }, 404);
        const gate = await gateAt(c, { baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return respond(c, () => createWorkflow(baseId, c.req.valid("json"), currentActorUserId(c)), 201);
      },
    )
    .get(
      "/:workflowId",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Get a workflow",
        responses: {
          200: jsonResponse(GridsWorkflowSchema, "Workflow"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const workflow = await getWorkflow(c.req.param("workflowId")!);
        if (!workflow || !(await canReadWorkflow(c, workflow))) return c.json({ message: "Workflow not found" }, 404);
        return c.json(workflow);
      },
    )
    .patch(
      "/:workflowId",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Update a workflow",
        parameters: [
          {
            name: WORKFLOW_REVISION_HEADER,
            in: "header",
            required: true,
            description: "Current workflow revision returned by the API.",
            schema: { type: "integer", minimum: 1 },
          },
        ],
        responses: {
          200: jsonResponse(GridsWorkflowSchema, "Updated"),
          400: jsonResponse(ErrorResponseSchema, "Invalid workflow"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
          409: jsonResponse(ErrorResponseSchema, "Revision conflict"),
        },
      }),
      v("json", UpdateGridsWorkflowSchema),
      async (c) => {
        const workflowId = c.req.param("workflowId")!;
        const workflow = await getWorkflow(workflowId);
        if (!workflow) return c.json({ message: "Workflow not found" }, 404);
        const gate = await gateAt(c, { baseId: workflow.baseId, workflowId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const expectedRevision = Number(c.req.header(WORKFLOW_REVISION_HEADER));
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
          return c.json({ message: `${WORKFLOW_REVISION_HEADER} must contain the workflow revision.` }, 400);
        }
        return respond(c, () => updateWorkflow(workflowId, c.req.valid("json"), currentActorUserId(c), expectedRevision));
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
        const workflow = await getWorkflow(workflowId);
        if (!workflow) return c.json({ message: "Workflow not found" }, 404);
        const gate = await gateAt(c, { baseId: workflow.baseId, workflowId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const result = await removeWorkflow(workflowId, currentActorUserId(c));
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        return c.body(null, 204);
      },
    )
    .get(
      "/:workflowId/launchers",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "List workflow launchers",
        responses: {
          200: jsonResponse(GridsWorkflowLauncherListSchema, "Launchers"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const workflow = await getWorkflow(c.req.param("workflowId")!);
        if (!workflow || !(await canReadWorkflow(c, workflow))) return c.json({ message: "Workflow not found" }, 404);
        return c.json({ items: await listLaunchers(workflow.id) });
      },
    )
    .post(
      "/:workflowId/launchers",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Create a workflow launcher",
        responses: {
          201: jsonResponse(GridsWorkflowLauncherSchema, "Created"),
          400: jsonResponse(ErrorResponseSchema, "Invalid launcher"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("json", CreateGridsWorkflowLauncherSchema),
      async (c) => {
        const workflow = await getWorkflow(c.req.param("workflowId")!);
        if (!workflow) return c.json({ message: "Workflow not found" }, 404);
        const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return respond(c, () => createLauncher(workflow, c.req.valid("json"), currentActorUserId(c)), 201);
      },
    )
    .get(
      "/launchers/:launcherId",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Get a workflow launcher",
        responses: {
          200: jsonResponse(GridsWorkflowLauncherSchema, "Launcher"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const loaded = await loadReadableLauncher(c, c.req.param("launcherId")!);
        return loaded ? c.json(loaded.launcher) : c.json({ message: "Workflow launcher not found" }, 404);
      },
    )
    .patch(
      "/launchers/:launcherId",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Update and revalidate a workflow launcher",
        responses: {
          200: jsonResponse(GridsWorkflowLauncherSchema, "Updated"),
          400: jsonResponse(ErrorResponseSchema, "Invalid launcher"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("json", UpdateGridsWorkflowLauncherSchema),
      async (c) => {
        const launcher = await getLauncher(c.req.param("launcherId")!);
        if (!launcher) return c.json({ message: "Workflow launcher not found" }, 404);
        const workflow = await getWorkflow(launcher.workflowId);
        if (!workflow) return c.json({ message: "Workflow launcher not found" }, 404);
        const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return respond(c, () => updateLauncher(launcher, workflow, c.req.valid("json"), currentActorUserId(c)));
      },
    )
    .delete(
      "/launchers/:launcherId",
      describeRoute({
        tags: ["Grids:Workflow"],
        summary: "Delete a workflow launcher",
        responses: {
          204: { description: "Deleted" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const launcher = await getLauncher(c.req.param("launcherId")!);
        if (!launcher) return c.json({ message: "Workflow launcher not found" }, 404);
        const workflow = await getWorkflow(launcher.workflowId);
        if (!workflow) return c.json({ message: "Workflow launcher not found" }, 404);
        const gate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        await removeLauncher(launcher, currentActorUserId(c));
        return c.body(null, 204);
      },
    );
