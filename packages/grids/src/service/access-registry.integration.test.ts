import { beforeAll, describe, expect, test } from "bun:test";
import type { PermissionLevel } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { migrate } from "../migrate";
import {
  type AccessBinding,
  grantAccess,
  listAccessForBaseTree,
  listBaseAccess,
  listDashboardAccess,
  listDocumentTemplateAccess,
  listFormAccess,
  listTableAccess,
  listViewAccess,
  listWorkflowAccess,
  resolveAccessBinding,
  resolveResourceBinding,
} from "./access";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;
const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

const fixture = () => ({
  baseId: uuid(),
  tableId: uuid(),
  viewId: uuid(),
  formId: uuid(),
  documentTemplateId: uuid(),
  dashboardId: uuid(),
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
    INSERT INTO grids.workflows (id, short_id, base_id, name, source)
    VALUES (${item.workflowId}::uuid, ${shortId("W")}, ${item.baseId}::uuid, 'Check in', 'steps: []')
  `;
};

const resources = (item: Fixture): Array<{ type: AccessBinding["resourceType"]; id: string; permission: PermissionLevel }> => [
  { type: "base", id: item.baseId, permission: "admin" },
  { type: "table", id: item.tableId, permission: "read" },
  { type: "view", id: item.viewId, permission: "read" },
  { type: "form", id: item.formId, permission: "write" },
  { type: "documentTemplate", id: item.documentTemplateId, permission: "admin" },
  { type: "dashboard", id: item.dashboardId, permission: "read" },
  { type: "workflow", id: item.workflowId, permission: "write" },
];

const cleanup = async (item: Fixture, accessIds: string[]) => {
  await sql`DELETE FROM grids.audit_log WHERE base_id = ${item.baseId}::uuid`;
  await sql`DELETE FROM grids.bases WHERE id = ${item.baseId}::uuid`;
  for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("access resource registry integration", () => {
  postgresTest("grants, lists, resolves, and base-tree projects every registered resource", async () => {
    const item = fixture();
    const accessIds: string[] = [];
    try {
      await insertFixture(item);
      for (const resource of resources(item)) {
        const result = await grantAccess({
          resourceType: resource.type,
          resourceId: resource.id,
          principal: { type: "public" },
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
        listWorkflowAccess(item.workflowId),
      ]);
      expect(lists.map((entries) => entries.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);

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
        "workflow",
      ]);
    } finally {
      await cleanup(item, accessIds);
    }
  });
});
