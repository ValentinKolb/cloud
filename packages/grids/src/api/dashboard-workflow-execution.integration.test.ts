import { beforeAll, describe, expect, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import type { WorkflowDefinition } from "../contracts";
import { migrate } from "../migrate";
import { canReadDashboardIncludedData } from "../service/dashboard-included-access";
import * as dashboardService from "../service/dashboards";
import { loadGrantsForUser, type ResolveTarget, resolveEffectivePermission } from "../service/permission-resolver";
import { workflowTriggerRuntime } from "../service/workflow-trigger-runtime";
import * as workflowService from "../service/workflows";
import { canReadDashboardForRequest, createDashboardsApi } from "./dashboards";
import { createWorkflowsApi } from "./workflows";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type DashboardWorkflowFixture = {
  baseId: string;
  dashboardId: string;
  widgetId: string;
  workflowId: string;
  accessIds: string[];
};

const testUser = (id: string): User => ({
  id,
  uid: `dashboard-workflow-${id}`,
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Dashboard",
  sn: "Workflow",
  displayName: "Dashboard Workflow",
  mail: `dashboard-workflow-${id}@example.test`,
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
  ipa: null,
});

const authenticateAs =
  (user: User): MiddlewareHandler<AuthContext> =>
  async (c, next) => {
    c.set("actor", { kind: "user", user });
    c.set("accessSubject", { type: "user", userId: user.id });
    c.set("user", user);
    await next();
  };

const resolveDashboardAccess = async (c: Context<AuthContext>, target: ResolveTarget) => {
  const user = c.get("user");
  const grants = await loadGrantsForUser({
    userId: user?.id ?? null,
    userGroups: user?.memberofGroupIds ?? [],
    serviceAccountId: null,
    baseId: target.baseId,
    dashboardId: "dashboardId" in target ? target.dashboardId : null,
  });
  return {
    grants,
    level: resolveEffectivePermission(grants, target),
  };
};

const apiFor = (user: User) =>
  new Hono<AuthContext>()
    .route(
      "/api/dashboards",
      createDashboardsApi({
        requireAuthenticated: authenticateAs(user),
        workflowTriggerRuntime,
        getDashboard: dashboardService.get,
        getWorkflow: workflowService.get,
        canReadDashboard: (c, dashboard) => canReadDashboardForRequest(c, dashboard, resolveDashboardAccess),
      }),
    )
    .route("/api/workflows", createWorkflowsApi({ requireAuthenticated: authenticateAs(user), workflowTriggerRuntime }));

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const existingAuthUserId = async (): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    SELECT id::text AS id FROM auth.users ORDER BY id LIMIT 1
  `;
  if (!row) throw new Error("Dashboard workflow API integration test needs one existing auth.users row");
  return row.id;
};

const createAccess = async (baseId: string, userId: string, permission: "read" | "write"): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.access (user_id, permission)
    VALUES (${userId}::uuid, ${permission}::auth.permission_level)
    RETURNING id::text AS id
  `;
  if (!row) throw new Error("Failed to create access row");
  await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${row.id}::uuid)`;
  return row.id;
};

const dashboardWorkflowDefinition = (): WorkflowDefinition => ({
  triggers: { dashboardButton: { label: "Run check" } },
  steps: [{ setVariable: { name: "result", value: "ok" } }],
});

const insertFixture = async (userId: string): Promise<DashboardWorkflowFixture> => {
  const baseId = uuid();
  const dashboardId = uuid();
  const widgetId = uuid();
  const workflowId = uuid();
  const compiled = dashboardWorkflowDefinition();

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'Dashboard workflow execution')
  `;
  await sql`
    INSERT INTO grids.workflows (id, short_id, base_id, name, source, compiled, enabled, position)
    VALUES (
      ${workflowId}::uuid,
      ${shortId("W")},
      ${baseId}::uuid,
      'Dashboard-only workflow',
      'triggers:\n  dashboardButton: {}\nsteps:\n  - setVariable:\n      name: result\n      value: ok',
      ${compiled}::jsonb,
      true,
      0
    )
  `;
  await sql`
    INSERT INTO grids.dashboards (id, short_id, base_id, name, config, position)
    VALUES (
      ${dashboardId}::uuid,
      ${shortId("D")},
      ${baseId}::uuid,
      'Operations dashboard',
      ${{
        rows: [
          {
            id: "row-1",
            kind: "row",
            height: "md",
            cells: [
              {
                id: widgetId,
                kind: "workflow-button",
                span: 4,
                workflowId,
              },
            ],
          },
        ],
      }}::jsonb,
      0
    )
  `;

  return {
    baseId,
    dashboardId,
    widgetId,
    workflowId,
    accessIds: [await createAccess(baseId, userId, "read")],
  };
};

const cleanupFixture = async (fixture: DashboardWorkflowFixture): Promise<void> => {
  await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
  for (const accessId of fixture.accessIds) {
    await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
  }
};

const waitForRunCompletion = async (runId: string): Promise<string> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [run] = await sql<{ status: string }[]>`
      SELECT status FROM grids.workflow_runs WHERE id = ${runId}::uuid
    `;
    if (run && run.status !== "queued" && run.status !== "running") return run.status;
    await Bun.sleep(20);
  }
  throw new Error(`Workflow run ${runId} did not complete`);
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("dashboard-scoped workflow execution", () => {
  postgresTest("keeps personal dashboard workflow streams owner-or-explicit-grant scoped", async () => {
    const userId = await existingAuthUserId();
    const ownerId = uuid();
    await sql`
      INSERT INTO auth.users (id, uid, provider, profile, display_name, given_name, sn)
      VALUES (${ownerId}::uuid, ${`dashboard-owner-${ownerId}`}, 'local', 'user', 'Dashboard Owner', 'Dashboard', 'Owner')
    `;
    const fixture = await insertFixture(userId);
    try {
      await sql`UPDATE grids.dashboards SET owner_user_id = ${ownerId}::uuid WHERE id = ${fixture.dashboardId}::uuid`;
      const dashboard = await dashboardService.get(fixture.dashboardId);
      if (!dashboard) throw new Error("Expected dashboard");
      expect(await canReadDashboardIncludedData(dashboard, { userId, userGroups: [] })).toBe(false);

      const [access] = await sql<Array<{ id: string }>>`
        INSERT INTO auth.access (user_id, permission)
        VALUES (${userId}::uuid, 'read'::auth.permission_level)
        RETURNING id::text AS id
      `;
      if (!access) throw new Error("Expected dashboard access");
      fixture.accessIds.push(access.id);
      await sql`INSERT INTO grids.dashboard_access (dashboard_id, access_id) VALUES (${fixture.dashboardId}::uuid, ${access.id}::uuid)`;
      expect(await canReadDashboardIncludedData(dashboard, { userId, userGroups: [] })).toBe(true);
    } finally {
      await cleanupFixture(fixture);
      await sql`DELETE FROM auth.users WHERE id = ${ownerId}::uuid`;
    }
  });

  postgresTest("lets a dashboard reader run the saved widget workflow without generic workflow write access", async () => {
    const userId = await existingAuthUserId();
    const app = apiFor(testUser(userId));
    const fixture = await insertFixture(userId);
    try {
      const direct = await app.request(`/api/workflows/${fixture.workflowId}/run/dashboard-button`, jsonPost({ input: {} }));
      expect(direct.status).toBe(403);

      const dashboardRun = await app.request(
        `/api/dashboards/${fixture.dashboardId}/widgets/${fixture.widgetId}/run`,
        jsonPost({ input: {} }),
      );
      expect(dashboardRun.status).toBe(200);
      const body = (await dashboardRun.json()) as {
        id: string;
        workflowId: string;
        triggerKind: string;
        triggerInput: Record<string, unknown>;
      };
      expect(body.workflowId).toBe(fixture.workflowId);
      expect(body.triggerKind).toBe("dashboardButton");
      expect(body.triggerInput).toEqual({
        dashboardId: fixture.dashboardId,
        dashboardWidgetId: fixture.widgetId,
      });
      expect(await waitForRunCompletion(body.id)).toBe("succeeded");

      const status = await app.request(`/api/dashboards/${fixture.dashboardId}/widgets/${fixture.widgetId}/runs/${body.id}`);
      expect(status.status).toBe(200);
      const statusBody = (await status.json()) as {
        run: { id: string; status: string; triggerInput?: unknown };
        steps: Array<{ input?: unknown; output?: unknown }>;
      };
      expect(statusBody.run).toMatchObject({ id: body.id, status: "succeeded" });
      expect(statusBody.run.triggerInput).toBeUndefined();
      expect(statusBody.steps.length).toBeGreaterThan(0);
      expect(statusBody.steps[0]?.input).toBeUndefined();
      expect(statusBody.steps[0]?.output).toBeUndefined();

      const [unscoped] = await sql<Array<{ id: string }>>`
        INSERT INTO grids.workflow_runs (
          workflow_id, base_id, workflow_definition, workflow_catalog, trigger_authorization, trigger_kind, trigger_input, resolved_input, status, finished_at
        )
        VALUES (
          ${fixture.workflowId}::uuid, ${fixture.baseId}::uuid,
          '{"triggers":{"dashboardButton":{}},"steps":[]}'::jsonb,
          '{"tables":[],"fieldsByTable":{},"templates":[],"emailTemplates":[]}'::jsonb, '{"kind":"workflow"}'::jsonb,
          'dashboardButton', '{}'::jsonb, '{}'::jsonb, 'succeeded', now()
        )
        RETURNING id::text AS id
      `;
      if (!unscoped) throw new Error("Expected unscoped run");
      const hidden = await app.request(`/api/dashboards/${fixture.dashboardId}/widgets/${fixture.widgetId}/runs/${unscoped.id}`);
      expect(hidden.status).toBe(404);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
