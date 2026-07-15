import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import type { WorkflowBoundPlan } from "@valentinkolb/cloud/workflows";
import { ok } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import type { Dashboard } from "../contracts";
import { migrate } from "../migrate";
import { canReadDashboardIncludedData } from "../service/dashboard-included-access";
import * as dashboardService from "../service/dashboards";
import { loadGrantsForUser, type ResolveTarget, resolveEffectivePermission } from "../service/permission-resolver";
import type {
  invokeDashboardLauncher as invokeDashboardLauncherService,
  invokeScannerLauncher as invokeScannerLauncherService,
} from "../service/workflow-kernel-launchers";
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
  launcherId: string;
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

const authenticateAsDelegated =
  (user: User, serviceAccountId: string, credentialId: string): MiddlewareHandler<AuthContext> =>
  async (c, next) => {
    c.set("actor", {
      kind: "service_account",
      serviceAccount: {
        id: serviceAccountId,
        name: "Delegated dashboard key",
        kind: "user_delegated",
        status: "active",
        delegatedUserId: user.id,
        appId: null,
        resourceType: null,
        resourceId: null,
        createdBy: user.id,
        createdAt: "2026-07-15T00:00:00.000Z",
      },
      delegatedUser: user,
      scopes: ["grids:write"],
      credentialId,
      credentialExpiresAt: "2026-07-16T00:00:00.000Z",
    });
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
        getDashboard: dashboardService.get,
        canReadDashboard: (c, dashboard) => canReadDashboardForRequest(c, dashboard, resolveDashboardAccess),
      }),
    )
    .route("/api/workflows", createWorkflowsApi({ requireAuthenticated: authenticateAs(user) }));

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

const dashboardWorkflowPlan = (): WorkflowBoundPlan =>
  ({
      schemaVersion: 2,
    languageId: "grids",
    languageVersion: 1,
    sourceHash: "dashboard-source",
    manifestHash: "dashboard-manifest",
    catalogHash: "dashboard-catalog",
    actionPolicies: {},
    inputs: [],
    triggers: [],
    steps: [],
    bindings: {},
  }) as WorkflowBoundPlan;

const dashboardWithLauncher = (baseId: string, dashboardId: string, widgetId: string, launcherId: string): Dashboard => ({
  id: dashboardId,
  shortId: "D1234",
  baseId,
  name: "Dashboard",
  description: null,
  icon: null,
  config: { rows: [{ id: "row-1", kind: "row", height: "md", cells: [{ id: widgetId, kind: "workflow-button", launcherId }] }] },
  ownerUserId: null,
  position: 0,
  deletedAt: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
});

const insertFixture = async (userId: string): Promise<DashboardWorkflowFixture> => {
  const baseId = uuid();
  const dashboardId = uuid();
  const widgetId = uuid();
  const workflowId = uuid();
  const launcherId = uuid();
  const plan = dashboardWorkflowPlan();

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'Dashboard workflow execution')
  `;
  await sql`
    INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, diagnostics, enabled, position, revision)
    VALUES (
      ${workflowId}::uuid,
      ${shortId("W")},
      ${baseId}::uuid,
      'Dashboard-only workflow',
      'steps: []',
      ${plan}::jsonb,
      '[]'::jsonb,
      true,
      0,
      1
    )
  `;
  await sql`
    INSERT INTO grids.workflow_launchers (
      id, short_id, base_id, workflow_id, name, kind, config, enabled, validated_revision, diagnostics
    ) VALUES (
      ${launcherId}::uuid,
      ${shortId("L")},
      ${baseId}::uuid,
      ${workflowId}::uuid,
      'Dashboard launcher',
      'dashboard',
      ${{ kind: "dashboard" }}::jsonb,
      true,
      1,
      '[]'::jsonb
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
                launcherId,
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
    launcherId,
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
  test("rejects an invalid dashboard id before querying PostgreSQL", async () => {
    const response = await apiFor(testUser(uuid())).request("/api/dashboards/not-a-uuid");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Invalid dashboard id" });
  });

  test("invokes the saved dashboard launcher with server-trusted widget authorization", async () => {
    const user = testUser(uuid());
    const serviceAccountId = uuid();
    const credentialId = uuid();
    const baseId = uuid();
    const dashboardId = uuid();
    const workflowId = uuid();
    const launcherId = uuid();
    const widgetId = "widget-dashboard";
    const invokeDashboardLauncher = mock<typeof invokeDashboardLauncherService>(async () =>
      ok({
        runId: uuid(),
        workflowId,
        revision: "4",
        mode: "execute" as const,
        channel: "dashboard" as const,
        created: true,
        status: "queued" as const,
      }),
    );
    const app = new Hono<AuthContext>().route(
      "/api/dashboards",
      createDashboardsApi({
        requireAuthenticated: authenticateAsDelegated(user, serviceAccountId, credentialId),
        getDashboard: mock(async () => dashboardWithLauncher(baseId, dashboardId, widgetId, launcherId)),
        getLauncher: mock(async () => ({
          id: launcherId,
          shortId: "L1234",
          baseId,
          workflowId,
          name: "Dashboard launcher",
          config: { kind: "dashboard" as const },
          enabled: true,
          validatedRevision: 4,
          diagnostics: [],
          deletedAt: null,
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:00:00.000Z",
        })),
        invokeDashboardLauncher,
        canReadDashboard: mock(async () => true),
      }),
    );

    const response = await app.request(`/api/dashboards/${dashboardId}/widgets/${widgetId}/run`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(invokeDashboardLauncher).toHaveBeenCalledTimes(1);
    expect(invokeDashboardLauncher.mock.calls[0]![0]).toMatchObject({
      launcherId,
      mode: "execute",
      expectedRevision: 4,
      inputs: {},
      principal: {
        userId: user.id,
        groupIds: [],
        serviceAccountId: null,
        actorServiceAccountId: serviceAccountId,
        credential: {
          kind: "api_token",
          id: credentialId,
          scopes: ["grids:write"],
          permissionCap: "write",
          expiresAt: "2026-07-16T00:00:00.000Z",
          resourceBinding: null,
        },
      },
      authorization: { kind: "dashboard-widget", dashboardId, dashboardWidgetId: widgetId },
    });
  });

  test("invokes the saved scanner launcher without accepting arbitrary workflow inputs", async () => {
    const user = testUser(uuid());
    const baseId = uuid();
    const dashboardId = uuid();
    const workflowId = uuid();
    const launcherId = uuid();
    const widgetId = "widget-scanner";
    const invokeScannerLauncher = mock<typeof invokeScannerLauncherService>(async () =>
      ok({
        runId: uuid(),
        workflowId,
        revision: "2",
        mode: "execute" as const,
        channel: "scanner" as const,
        created: true,
        status: "queued" as const,
      }),
    );
    const app = new Hono<AuthContext>().route(
      "/api/dashboards",
      createDashboardsApi({
        requireAuthenticated: authenticateAs(user),
        getDashboard: mock(async () => dashboardWithLauncher(baseId, dashboardId, widgetId, launcherId)),
        getLauncher: mock(async () => ({
          id: launcherId,
          shortId: "L1234",
          baseId,
          workflowId,
          name: "Scanner launcher",
          config: { kind: "scanner" as const, input: "record", resolve: { by: "scanCode" as const } },
          enabled: true,
          validatedRevision: 2,
          diagnostics: [],
          deletedAt: null,
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:00:00.000Z",
        })),
        invokeScannerLauncher,
        canReadDashboard: mock(async () => true),
      }),
    );

    const rejected = await app.request(
      `/api/dashboards/${dashboardId}/widgets/${widgetId}/scan`,
      jsonPost({ code: "asset-42", operationId: "scan-42", expectedRevision: 2, inputs: { forbidden: true } }),
    );
    expect(rejected.status).toBe(400);
    expect(invokeScannerLauncher).not.toHaveBeenCalled();

    const response = await app.request(
      `/api/dashboards/${dashboardId}/widgets/${widgetId}/scan`,
      jsonPost({ code: "asset-42", operationId: "scan-42", expectedRevision: 2 }),
    );

    expect(response.status).toBe(200);
    expect(invokeScannerLauncher).toHaveBeenCalledTimes(1);
    expect(invokeScannerLauncher.mock.calls[0]![0]).toMatchObject({
      launcherId,
      operationId: "scan-42",
      mode: "execute",
      expectedRevision: 2,
      inputs: {},
      scannedText: "asset-42",
      authorization: { kind: "dashboard-widget", dashboardId, dashboardWidgetId: widgetId },
    });
  });

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
      const direct = await app.request(
        `/api/workflows/${fixture.workflowId}/invoke`,
        jsonPost({ mode: "execute", inputs: {}, idempotencyKey: "direct-dashboard-test" }),
      );
      expect(direct.status).toBe(403);

      const dashboardRun = await app.request(`/api/dashboards/${fixture.dashboardId}/widgets/${fixture.widgetId}/run`, {
        method: "POST",
      });
      expect(dashboardRun.status).toBe(200);
      const body = (await dashboardRun.json()) as {
        id: string;
        workflowId: string;
        launcherId: string;
        channel: string;
      };
      expect(body.workflowId).toBe(fixture.workflowId);
      expect(body.launcherId).toBe(fixture.launcherId);
      expect(body.channel).toBe("dashboard");
      expect(await waitForRunCompletion(body.id)).toBe("succeeded");
      await sql`
        UPDATE grids.workflow_runs
        SET error = '{"code":"INTERNAL","message":"private detail","retryable":false}'::jsonb,
            result_message = 'private result'
        WHERE id = ${body.id}::uuid
      `;
      await sql`
        INSERT INTO grids.workflow_step_runs (
          run_id, step_key, source_path, iteration_path, kind, action, mode, status, outcome, execution_generation, finished_at
        ) VALUES (
          ${body.id}::uuid, 'steps.redaction', '["steps",0]'::jsonb, '{2}'::int[], 'action', 'httpRequest',
          'execute', 'failed', '{"secret":"response body"}'::jsonb, 1, now()
        )
      `;

      const status = await app.request(`/api/dashboards/${fixture.dashboardId}/widgets/${fixture.widgetId}/runs/${body.id}`);
      expect(status.status).toBe(200);
      const statusBody = (await status.json()) as {
        run: { id: string; status: string; launcherId: string; mode: string; inputs?: unknown; error?: unknown; resultMessage?: unknown };
        steps: Array<{ outcome?: unknown; sourcePath?: unknown; iterationPath?: unknown }>;
      };
      expect(statusBody.run).toMatchObject({
        id: body.id,
        status: "succeeded",
        launcherId: fixture.launcherId,
        mode: "execute",
      });
      expect(statusBody.run.inputs).toBeUndefined();
      expect(statusBody.run.error).toBeUndefined();
      expect(statusBody.run.resultMessage).toBeUndefined();
      expect(statusBody.steps[0]?.outcome).toBeUndefined();
      expect(statusBody.steps[0]?.sourcePath).toBeUndefined();
      expect(statusBody.steps[0]?.iterationPath).toBeUndefined();

      const [unscoped] = await sql<Array<{ id: string }>>`
        INSERT INTO grids.workflow_runs (
          workflow_id, launcher_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
          authorization_snapshot, inputs, context, workflow_plan, status, occurred_at, finished_at
        )
        VALUES (
          ${fixture.workflowId}::uuid, ${fixture.launcherId}::uuid, ${fixture.baseId}::uuid, 1, 'execute', 'dashboard',
          'unscoped-dashboard-test', 'unscoped-dashboard-test', '{"kind":"workflow"}'::jsonb, '{}'::jsonb, '{}'::jsonb,
          ${dashboardWorkflowPlan()}::jsonb, 'succeeded', now(), now()
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
