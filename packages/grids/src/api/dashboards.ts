import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  CreateDashboardSchema,
  type Dashboard,
  DashboardListSchema,
  DashboardSchema,
  UpdateDashboardSchema,
  WidgetSchema,
} from "../contracts";
import { toWorkflowRunEventSummary, toWorkflowRunStepSummary } from "../lib/workflow-run-events";
import { gridsService } from "../service";
import { resolveWidgetData } from "../service/dashboard-widget-data";
import { get as getDashboardById } from "../service/dashboards";
import { hasAtLeast, hasGrantsForResource } from "../service/permission-resolver";
import { invokeDashboardLauncher, invokeScannerLauncher } from "../service/workflow-kernel-launchers";
import { listWorkflowStepRuns } from "../service/workflow-kernel-observability";
import { getWorkflowRun } from "../service/workflow-kernel-runs";
import { getLauncher as getWorkflowLauncher } from "../service/workflow-launchers";
import { GridsWorkflowRunSchema, GridsWorkflowRunStatusSchema, GridsWorkflowStepRunSchema } from "../workflows/contracts";
import { currentActorUser, currentActorUserId, currentActorViewer, gateAt, resolveWithGrants } from "./permissions";
import { uuidParam } from "./route-params";

const DashboardWorkflowScannerRunSchema = z
  .object({
    code: z.string().trim().min(1).max(500),
  })
  .strict();

const DashboardWorkflowInvocationResponseSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  launcherId: z.string().uuid(),
  channel: z.enum(["dashboard", "scanner"]),
  status: GridsWorkflowRunStatusSchema,
});

const DashboardWidgetAuthorizationSchema = z
  .object({
    kind: z.literal("dashboard-widget"),
    dashboardId: z.string().uuid(),
    dashboardWidgetId: z.string().min(1),
  })
  .strict();

type DashboardWidgetAuthorization = z.infer<typeof DashboardWidgetAuthorizationSchema>;

const getWorkflowRunAuthorization = async (runId: string): Promise<DashboardWidgetAuthorization | null> => {
  const [row] = await sql<Array<{ authorization: unknown }>>`
    SELECT authorization_snapshot AS authorization
    FROM grids.workflow_runs
    WHERE id = ${runId}::uuid
  `;
  const parsed = DashboardWidgetAuthorizationSchema.safeParse(row?.authorization);
  return parsed.success ? parsed.data : null;
};

const DashboardWorkflowRunStatusSchema = z.object({
  run: GridsWorkflowRunSchema.pick({
    id: true,
    workflowId: true,
    launcherId: true,
    baseId: true,
    workflowRevision: true,
    mode: true,
    channel: true,
    status: true,
    error: true,
    resultMessage: true,
    createdAt: true,
    startedAt: true,
    finishedAt: true,
  }),
  steps: z.array(
    GridsWorkflowStepRunSchema.pick({
      id: true,
      runId: true,
      key: true,
      sourcePath: true,
      iterationPath: true,
      kind: true,
      action: true,
      status: true,
      outcome: true,
      executionGeneration: true,
      startedAt: true,
      finishedAt: true,
    }),
  ),
});

// =============================================================================
// /api/grids/dashboards
//
// Permission rules (dashboards intentionally diverge from views):
//   - WRITE (POST/PATCH/DELETE/RESTORE) requires base-admin, regardless
//     of ownership. Owners who lose admin role keep read access on
//     their personal dashboard but cannot edit/delete it.
//   - READ visibility follows the view-style "default-shared, grant
//     overrides" rule: shared dashboards visible to base-readers,
//     personal dashboards to owner-or-explicit-grant. The direct GET
//     handler enforces this; listForBase mirrors it in SQL.
// =============================================================================

export const canReadDashboardForRequest = async (
  c: Context<AuthContext>,
  dashboard: Dashboard,
  resolveAccess: typeof resolveWithGrants = resolveWithGrants,
): Promise<boolean> => {
  const viewer = currentActorViewer(c);
  const { level, grants } = await resolveAccess(c, {
    baseId: dashboard.baseId,
    dashboardId: dashboard.id,
  });
  if (!hasAtLeast(level, "read")) return false;

  const isOwner = dashboard.ownerUserId === viewer.userId;
  const explicitGrant = hasGrantsForResource(grants, "dashboard", dashboard.id);
  if (dashboard.ownerUserId !== null && !isOwner && !explicitGrant) return false;
  return true;
};

export const createDashboardsApi = (
  deps: {
    requireAuthenticated?: MiddlewareHandler<AuthContext>;
    getDashboard?: typeof getDashboardById;
    getLauncher?: typeof getWorkflowLauncher;
    invokeDashboardLauncher?: typeof invokeDashboardLauncher;
    invokeScannerLauncher?: typeof invokeScannerLauncher;
    getWorkflowRun?: typeof getWorkflowRun;
    getWorkflowRunAuthorization?: typeof getWorkflowRunAuthorization;
    listWorkflowStepRuns?: typeof listWorkflowStepRuns;
    canReadDashboard?: typeof canReadDashboardForRequest;
  } = {},
) => {
  const requireAuthenticated = deps.requireAuthenticated ?? auth.requireRole("authenticated");
  const getDashboard = deps.getDashboard ?? getDashboardById;
  const getLauncher = deps.getLauncher ?? getWorkflowLauncher;
  const invokeDashboard = deps.invokeDashboardLauncher ?? invokeDashboardLauncher;
  const invokeScanner = deps.invokeScannerLauncher ?? invokeScannerLauncher;
  const getWorkflowRunImpl = deps.getWorkflowRun ?? getWorkflowRun;
  const getWorkflowRunAuthorizationImpl = deps.getWorkflowRunAuthorization ?? getWorkflowRunAuthorization;
  const listWorkflowStepRunsImpl = deps.listWorkflowStepRuns ?? listWorkflowStepRuns;
  const canReadDashboard = deps.canReadDashboard ?? canReadDashboardForRequest;

  return new Hono<AuthContext>()
    .use(requireAuthenticated)

    .get(
      "/by-base/:baseId",
      describeRoute({
        tags: ["Grids:Dashboard"],
        summary: "List dashboards visible on a base",
        responses: { 200: jsonResponse(DashboardListSchema, "Dashboards") },
      }),
      async (c) => {
        const baseId = uuidParam(c, "baseId");
        if (!baseId) return c.json({ message: "Invalid base id" }, 400);
        const base = await gridsService.base.get(baseId);
        if (!base) return c.json({ message: "Base not found" }, 404);
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const list = await gridsService.dashboard.listForBase({
          baseId,
          ...currentActorViewer(c),
        });
        return c.json(list);
      },
    )

    .post(
      "/by-base/:baseId",
      describeRoute({
        tags: ["Grids:Dashboard"],
        summary: "Create a dashboard (shared or personal)",
        responses: {
          201: jsonResponse(DashboardSchema, "Created"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", CreateDashboardSchema),
      async (c) => {
        const baseId = uuidParam(c, "baseId");
        if (!baseId) return c.json({ message: "Invalid base id" }, 400);
        const base = await gridsService.base.get(baseId);
        if (!base) return c.json({ message: "Base not found" }, 404);
        const body = c.req.valid("json");
        // Locked product rule: dashboard write requires base-admin
        // regardless of ownership — same as PATCH/DELETE/RESTORE. A
        // table-reader cannot create a personal dashboard they couldn't
        // later edit anyway. Read access still has the usual personal-vs-
        // shared visibility (see direct GET).
        const gate = await gateAt(c, { baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const user = currentActorUser(c);
        if (!body.shared && !user) return c.json({ message: "Sign in to create a personal dashboard." }, 403);
        return respond(
          c,
          () =>
            gridsService.dashboard.create(
              {
                baseId,
                name: body.name,
                description: body.description ?? null,
                icon: body.icon ?? null,
                config: body.config,
                ownerUserId: body.shared ? null : (user?.id ?? null),
              },
              currentActorUserId(c),
            ),
          201,
        );
      },
    )

    .get(
      "/:dashboardId",
      describeRoute({
        tags: ["Grids:Dashboard"],
        summary: "Get a single dashboard",
        responses: {
          200: jsonResponse(DashboardSchema, "Dashboard"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const dashboardId = uuidParam(c, "dashboardId");
        if (!dashboardId) return c.json({ message: "Invalid dashboard id" }, 400);
        const dashboard = await getDashboard(dashboardId);
        if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);

        // Gate at the dashboard scope (most specific), including
        // dashboard-level deny grants. Failures land as 404 rather than
        // 403 to avoid leaking the resource's existence.
        if (!(await canReadDashboard(c, dashboard))) return c.json({ message: "Dashboard not found" }, 404);
        return c.json(dashboard);
      },
    )

    .post(
      "/:dashboardId/widgets/resolve",
      describeRoute({
        tags: ["Grids:Dashboard"],
        summary: "Resolve one dashboard widget",
        responses: {
          200: { description: "Resolved widget data" },
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("json", WidgetSchema),
      async (c) => {
        const dashboardId = uuidParam(c, "dashboardId");
        if (!dashboardId) return c.json({ message: "Invalid dashboard id" }, 400);
        const dashboard = await getDashboard(dashboardId);
        if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);

        const writeGate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
        if (!writeGate.ok) return respond(c, () => Promise.resolve(writeGate));

        if (!(await canReadDashboard(c, dashboard))) return c.json({ message: "Dashboard not found" }, 404);

        const viewer = currentActorViewer(c);
        const data = await resolveWidgetData(c.req.valid("json"), viewer, {
          dateConfig: await getDateConfig(c),
        });
        return c.json(data);
      },
    )

    .post(
      "/:dashboardId/widgets/:widgetId/run",
      describeRoute({
        tags: ["Grids:Dashboard"],
        summary: "Run a dashboard workflow button",
        responses: {
          200: jsonResponse(DashboardWorkflowInvocationResponseSchema, "Run"),
          400: jsonResponse(ErrorResponseSchema, "Invalid input"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const dashboardId = uuidParam(c, "dashboardId");
        if (!dashboardId) return c.json({ message: "Invalid dashboard id" }, 400);
        const widgetId = c.req.param("widgetId")!;
        const dashboard = await getDashboard(dashboardId);
        if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
        if (!(await canReadDashboard(c, dashboard))) return c.json({ message: "Dashboard not found" }, 404);

        const widget = dashboard.config.rows.flatMap((row) => row.cells).find((cell) => cell.id === widgetId);
        if (!widget || widget.kind !== "workflow-button") return c.json({ message: "Widget not found" }, 404);

        const launcher = await getLauncher(widget.launcherId);
        if (!launcher || launcher.baseId !== dashboard.baseId) return c.json({ message: "Workflow launcher not found" }, 404);
        if (launcher.config.kind !== "dashboard") return c.json({ message: "Workflow launcher is not a dashboard launcher" }, 400);
        const viewer = currentActorViewer(c);
        const result = await invokeDashboard({
          launcherId: launcher.id,
          operationId: Bun.randomUUIDv7(),
          mode: "execute",
          expectedRevision: launcher.validatedRevision,
          principal: { userId: viewer.userId, groupIds: viewer.userGroups, serviceAccountId: viewer.serviceAccountId },
          inputs: {},
          authorization: { kind: "dashboard-widget", dashboardId: dashboard.id, dashboardWidgetId: widget.id },
        });
        if (!result.ok) return respond(c, () => Promise.resolve(result));
        return c.json({
          id: result.data.runId,
          workflowId: result.data.workflowId,
          launcherId: launcher.id,
          channel: "dashboard" as const,
          status: result.data.status,
        });
      },
    )

    .post(
      "/:dashboardId/widgets/:widgetId/scan",
      describeRoute({
        tags: ["Grids:Dashboard"],
        summary: "Run a dashboard scanner workflow button",
        responses: {
          200: jsonResponse(DashboardWorkflowInvocationResponseSchema, "Run"),
          400: jsonResponse(ErrorResponseSchema, "Invalid scanner input"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("json", DashboardWorkflowScannerRunSchema),
      async (c) => {
        const dashboardId = uuidParam(c, "dashboardId");
        if (!dashboardId) return c.json({ message: "Invalid dashboard id" }, 400);
        const widgetId = c.req.param("widgetId")!;
        const dashboard = await getDashboard(dashboardId);
        if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
        if (!(await canReadDashboard(c, dashboard))) return c.json({ message: "Dashboard not found" }, 404);

        const widget = dashboard.config.rows.flatMap((row) => row.cells).find((cell) => cell.id === widgetId);
        if (!widget || widget.kind !== "workflow-button") return c.json({ message: "Widget not found" }, 404);

        const launcher = await getLauncher(widget.launcherId);
        if (!launcher || launcher.baseId !== dashboard.baseId) return c.json({ message: "Workflow launcher not found" }, 404);
        if (launcher.config.kind !== "scanner") return c.json({ message: "Workflow launcher is not a scanner launcher" }, 400);
        const viewer = currentActorViewer(c);
        const result = await invokeScanner({
          launcherId: launcher.id,
          operationId: Bun.randomUUIDv7(),
          mode: "execute",
          expectedRevision: launcher.validatedRevision,
          principal: { userId: viewer.userId, groupIds: viewer.userGroups, serviceAccountId: viewer.serviceAccountId },
          inputs: {},
          scannedText: c.req.valid("json").code,
          authorization: { kind: "dashboard-widget", dashboardId: dashboard.id, dashboardWidgetId: widget.id },
        });
        if (!result.ok) return respond(c, () => Promise.resolve(result));
        return c.json({
          id: result.data.runId,
          workflowId: result.data.workflowId,
          launcherId: launcher.id,
          channel: "scanner" as const,
          status: result.data.status,
        });
      },
    )

    .get(
      "/:dashboardId/widgets/:widgetId/runs/:runId",
      describeRoute({
        tags: ["Grids:Dashboard"],
        summary: "Get a dashboard workflow run and its steps",
        responses: {
          200: jsonResponse(DashboardWorkflowRunStatusSchema, "Run status"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const dashboardId = uuidParam(c, "dashboardId");
        if (!dashboardId) return c.json({ message: "Invalid dashboard id" }, 400);
        const widgetId = c.req.param("widgetId")!;
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Invalid workflow run id" }, 400);
        const dashboard = await getDashboard(dashboardId);
        if (!dashboard || !(await canReadDashboard(c, dashboard))) return c.json({ message: "Dashboard not found" }, 404);
        const widget = dashboard.config.rows.flatMap((row) => row.cells).find((cell) => cell.id === widgetId);
        if (!widget || widget.kind !== "workflow-button") return c.json({ message: "Widget not found" }, 404);
        const [run, authorization] = await Promise.all([getWorkflowRunImpl(runId), getWorkflowRunAuthorizationImpl(runId)]);
        if (
          !run ||
          run.launcherId !== widget.launcherId ||
          authorization?.dashboardId !== dashboard.id ||
          authorization.dashboardWidgetId !== widget.id
        ) {
          return c.json({ message: "Workflow run not found" }, 404);
        }
        return c.json({
          run: toWorkflowRunEventSummary(run),
          steps: (await listWorkflowStepRunsImpl(run.id)).map(toWorkflowRunStepSummary),
        });
      },
    )

    .patch(
      "/:dashboardId",
      describeRoute({
        tags: ["Grids:Dashboard"],
        summary: "Update a dashboard",
        responses: {
          200: jsonResponse(DashboardSchema, "Updated"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", UpdateDashboardSchema),
      async (c) => {
        const dashboardId = uuidParam(c, "dashboardId");
        if (!dashboardId) return c.json({ message: "Invalid dashboard id" }, 400);
        const dashboard = await getDashboard(dashboardId);
        if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
        const body = c.req.valid("json");
        if (body.shared === false && !currentActorUser(c)) return c.json({ message: "Sign in to make this dashboard personal." }, 403);

        // Dashboard writes require base-admin regardless of ownership.
        // Personal vs shared only affects READ visibility; owners who
        // lose admin role can still see their personal dashboard but can
        // no longer edit it.
        const gate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        return respond(c, () => gridsService.dashboard.update(dashboardId, body, currentActorUserId(c)));
      },
    )

    .delete(
      "/:dashboardId",
      describeRoute({
        tags: ["Grids:Dashboard"],
        summary: "Delete a dashboard",
        responses: {
          204: { description: "Deleted" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const dashboardId = uuidParam(c, "dashboardId");
        if (!dashboardId) return c.json({ message: "Invalid dashboard id" }, 400);
        const dashboard = await getDashboard(dashboardId);
        if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
        // Same rule as PATCH: dashboard write = base-admin.
        const gate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const result = await gridsService.dashboard.remove(dashboardId, currentActorUserId(c));
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        return c.body(null, 204);
      },
    )

    .post(
      "/:dashboardId/restore",
      describeRoute({
        tags: ["Grids:Dashboard"],
        summary: "Restore a soft-deleted dashboard",
        responses: {
          200: jsonResponse(DashboardSchema, "Restored"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const dashboardId = uuidParam(c, "dashboardId");
        if (!dashboardId) return c.json({ message: "Invalid dashboard id" }, 400);
        const dashboard = await getDashboard(dashboardId, { includeDeleted: true });
        if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
        // Restore is a write — base-admin only, regardless of ownership.
        const gate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return respond(c, () => gridsService.dashboard.restore(dashboardId, currentActorUserId(c)));
      },
    );
};

export default createDashboardsApi();
