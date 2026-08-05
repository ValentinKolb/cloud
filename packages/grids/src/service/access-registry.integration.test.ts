import { beforeAll, describe, expect, test } from "bun:test";
import type { PermissionLevel } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { migrate } from "../migrate";
import {
  type AccessBinding,
  grantAccess,
  listAccessForBaseTree,
  listBaseAccess,
  listCustomAppAccess,
  listDashboardAccess,
  listDocumentTemplateAccess,
  listFormAccess,
  listTableAccess,
  listViewAccess,
  listWorkflowAccess,
  lockBaseAuthorization,
  resolveAccessBinding,
  resolveResourceBinding,
} from "./access";
import { deleteTestWorkflowScope, insertTestWorkflow } from "./workflow-test-fixture";

const postgresTest = process.env.GRIDS_DB_TEST === "1" ? test : test.skip;
const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

const fixture = () => ({
  baseId: uuid(),
  tableId: uuid(),
  viewId: uuid(),
  formId: uuid(),
  documentTemplateId: uuid(),
  dashboardId: uuid(),
  customAppId: uuid(),
  workflowId: uuid(),
});

type Fixture = ReturnType<typeof fixture>;

const insertFixture = async (item: Fixture) => {
  await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${item.baseId}::uuid, ${shortId("B")}, 'Access registry')`;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name)
    VALUES (${item.tableId}::uuid, ${shortId("T")}, ${item.baseId}::uuid, 'Inventory')
  `;
  await sql`
    INSERT INTO grids.views (id, short_id, table_id, name, source)
    VALUES (${item.viewId}::uuid, ${shortId("V")}, ${item.tableId}::uuid, 'Available items', ${`from table {${item.tableId}}`})
  `;
  await sql`
    INSERT INTO grids.forms (id, short_id, table_id, name)
    VALUES (${item.formId}::uuid, ${shortId("F")}, ${item.tableId}::uuid, 'Return item')
  `;
  await sql`
    INSERT INTO grids.document_templates (id, short_id, table_id, name, source, html)
    VALUES (${item.documentTemplateId}::uuid, ${shortId("D")}, ${item.tableId}::uuid, 'Item label', ${`from table {${item.tableId}}`}, '<p>Item</p>')
  `;
  await sql`
    INSERT INTO grids.dashboards (id, short_id, base_id, name)
    VALUES (${item.dashboardId}::uuid, ${shortId("A")}, ${item.baseId}::uuid, 'Operations')
  `;
  await sql`
    INSERT INTO grids.custom_apps (id, short_id, base_id, name, draft_definition, draft_capabilities)
    VALUES (${item.customAppId}::uuid, ${shortId("C")}, ${item.baseId}::uuid, 'Request portal', '{}'::jsonb, '{"views":[]}'::jsonb)
  `;
  await insertTestWorkflow({
    id: item.workflowId,
    shortId: shortId("W"),
    baseId: item.baseId,
    name: "Check in",
    source: "steps: []",
    plan: { inputs: [], triggers: [], steps: [], bindings: {} },
  });
};

const resources = (item: Fixture): Array<{ type: AccessBinding["resourceType"]; id: string; permission: PermissionLevel }> => [
  { type: "base", id: item.baseId, permission: "admin" },
  { type: "table", id: item.tableId, permission: "read" },
  { type: "view", id: item.viewId, permission: "read" },
  { type: "form", id: item.formId, permission: "write" },
  { type: "documentTemplate", id: item.documentTemplateId, permission: "admin" },
  { type: "dashboard", id: item.dashboardId, permission: "read" },
  { type: "customApp", id: item.customAppId, permission: "read" },
  { type: "workflow", id: item.workflowId, permission: "write" },
];

const cleanup = async (item: Fixture, accessIds: string[]) => {
  await sql`DELETE FROM grids.audit_log WHERE base_id = ${item.baseId}::uuid`;
  await deleteTestWorkflowScope(item.baseId);
  await sql`DELETE FROM grids.bases WHERE id = ${item.baseId}::uuid`;
  for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
};

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("access resource registry integration", () => {
  postgresTest("rechecks base administration after a concurrent revocation", async () => {
    const item = fixture();
    const [user] = await sql<Array<{ id: string }>>`SELECT id::text FROM auth.users ORDER BY id LIMIT 1`;
    if (!user) throw new Error("Access registry integration test needs one auth user");
    const [adminAccess] = await sql<Array<{ id: string }>>`
      INSERT INTO auth.access (user_id, permission)
      VALUES (${user.id}::uuid, 'admin')
      RETURNING id::text
    `;
    if (!adminAccess) throw new Error("Failed to create admin access fixture");
    let releaseRevocation = () => {};
    let revocationLocked = () => {};
    const waitForRelease = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    const waitForLock = new Promise<void>((resolve) => {
      revocationLocked = resolve;
    });
    try {
      await insertFixture(item);
      await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${item.baseId}::uuid, ${adminAccess.id}::uuid)`;
      const revocation = sql.begin(async (tx) => {
        await lockBaseAuthorization([item.baseId], tx);
        await tx`DELETE FROM auth.access WHERE id = ${adminAccess.id}::uuid`;
        revocationLocked();
        await waitForRelease;
      });
      await waitForLock;
      const grant = grantAccess({
        resourceType: "table",
        resourceId: item.tableId,
        principal: { type: "public" },
        permission: "read",
        actorId: user.id,
        authorization: { subject: { type: "user", userId: user.id }, permissionCap: "admin" },
      });
      await Bun.sleep(20);
      releaseRevocation();
      await revocation;
      const result = await grant;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.status).toBe(403);
      expect(await listTableAccess(item.tableId)).toHaveLength(0);
    } finally {
      releaseRevocation();
      await cleanup(item, [adminAccess.id]);
    }
  });

  postgresTest("grants, lists, resolves, and base-tree projects every registered resource", async () => {
    const item = fixture();
    const accessIds: string[] = [];
    try {
      await insertFixture(item);
      for (const resource of resources(item)) {
        const result = await grantAccess({
          resourceType: resource.type,
          resourceId: resource.id,
          principal: resource.type === "customApp" ? { type: "authenticated" } : { type: "public" },
          permission: resource.permission,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        accessIds.push(result.data.accessId);
      }

      const lists = await Promise.all([
        listBaseAccess(item.baseId),
        listTableAccess(item.tableId),
        listViewAccess(item.viewId),
        listFormAccess(item.formId),
        listDocumentTemplateAccess(item.documentTemplateId),
        listDashboardAccess(item.dashboardId),
        listCustomAppAccess(item.customAppId),
        listWorkflowAccess(item.workflowId),
      ]);
      expect(lists.map((entries) => entries.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);

      const bindings = await Promise.all(accessIds.map((accessId) => resolveAccessBinding(accessId)));
      expect(bindings).toEqual([
        { resourceType: "base", baseId: item.baseId },
        { resourceType: "table", baseId: item.baseId, tableId: item.tableId },
        { resourceType: "view", baseId: item.baseId, tableId: item.tableId, viewId: item.viewId },
        { resourceType: "form", baseId: item.baseId, tableId: item.tableId, formId: item.formId },
        {
          resourceType: "documentTemplate",
          baseId: item.baseId,
          tableId: item.tableId,
          documentTemplateId: item.documentTemplateId,
        },
        { resourceType: "dashboard", baseId: item.baseId, dashboardId: item.dashboardId },
        { resourceType: "customApp", baseId: item.baseId, customAppId: item.customAppId },
        { resourceType: "workflow", baseId: item.baseId, workflowId: item.workflowId },
      ]);

      const resourceBindings = await Promise.all(resources(item).map((resource) => resolveResourceBinding(resource.type, resource.id)));
      expect(resourceBindings).toEqual(bindings);

      const tree = await listAccessForBaseTree(item.baseId);
      expect(tree.map((entry) => entry.resourceType)).toEqual([
        "base",
        "table",
        "view",
        "form",
        "documentTemplate",
        "dashboard",
        "customApp",
        "workflow",
      ]);
    } finally {
      await cleanup(item, accessIds);
    }
  });
});
