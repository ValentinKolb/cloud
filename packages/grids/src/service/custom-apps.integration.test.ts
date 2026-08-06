import { beforeAll, describe, expect } from "bun:test";
import { sql } from "bun";
import { migrate as migrateCoreWorkflows } from "../../../core/src/migrate/core/workflows";
import type { CustomAppDefinition } from "../custom-apps/contracts";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { grantAccess } from "./access";
import { apply, compile, get, plan, publish } from "./custom-apps";
import { getWorkflow } from "./workflow-definitions";
import { canExecuteWorkflow } from "./workflow-action-scope";
import { createLauncher } from "./workflow-launchers";
import { deleteTestWorkflowScope, insertTestWorkflow } from "./workflow-test-fixture";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") {
    await migrateCoreWorkflows();
    await migrate();
  }
});

describe("Custom App lifecycle", () => {
  postgresTest("compiles references and keeps draft changes isolated until publish", async () => {
    const baseId = testUuid();
    const tableId = testUuid();
    const viewId = testUuid();
    const fieldId = testUuid();
    const computedFieldId = testUuid();
    const relationFieldId = testUuid();
    const formId = testUuid();
    const otherTableId = testUuid();
    const otherFieldId = testUuid();
    const appId = testUuid();
    const workflowId = testUuid();
    const accessIds: string[] = [];
    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'Custom Apps')`;
      await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name)
        VALUES (${tableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Requests')
      `;
      await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
        VALUES (${fieldId}::uuid, ${testShortId("F")}, ${tableId}::uuid, 'Title', 'text', '{}'::jsonb, 0)
      `;
      await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
        VALUES (${computedFieldId}::uuid, ${testShortId("F")}, ${tableId}::uuid, 'Summary', 'formula', '{}'::jsonb, 1)
      `;
      await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
        VALUES (
          ${relationFieldId}::uuid,
          ${testShortId("F")},
          ${tableId}::uuid,
          'Parent request',
          'relation',
          ${JSON.stringify({ targetTableId: tableId, cardinality: "single" })}::jsonb,
          1
        )
      `;
      await sql`
        INSERT INTO grids.forms (id, short_id, table_id, name, config, is_active, position)
        VALUES (
          ${formId}::uuid,
          ${testShortId("M")},
          ${tableId}::uuid,
          'Request form',
          ${JSON.stringify({
            title: "Apply",
            fields: [
              { kind: "user_input", fieldId },
              { kind: "user_input", fieldId: relationFieldId },
            ],
          })}::jsonb,
          true,
          0
        )
      `;
      await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name)
        VALUES (${otherTableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Other records')
      `;
      await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
        VALUES (${otherFieldId}::uuid, ${testShortId("F")}, ${otherTableId}::uuid, 'Title', 'text', '{}'::jsonb, 0)
      `;
      await sql`
        INSERT INTO grids.views (id, short_id, table_id, name, source)
        VALUES (${viewId}::uuid, ${testShortId("V")}, ${tableId}::uuid, 'My requests', ${`from table {${tableId}}`})
      `;
      await insertTestWorkflow({
        baseId,
        id: workflowId,
        enabled: true,
        plan: {
          schemaVersion: 2,
          languageId: "grids",
          languageVersion: 1,
          sourceHash: "a".repeat(64),
          manifestHash: "b".repeat(64),
          catalogHash: "c".repeat(64),
          actionPolicies: {},
          inputs: [{ name: "request", type: "record", config: { required: true } }],
          triggers: [],
          steps: [],
          bindings: { "inputs.request.table": tableId },
        },
      });
      const workflow = await getWorkflow(workflowId);
      if (!workflow) throw new Error("Custom App workflow fixture is missing");
      const launcherResult = await createLauncher(
        workflow,
        { name: "Approve request", config: { kind: "dashboard", inputMode: "prompt" }, enabled: true },
        null,
      );
      if (!launcherResult.ok) throw new Error(launcherResult.error.message);
      const launcherId = launcherResult.data.id;

      const definition: CustomAppDefinition = {
        schemaVersion: 1,
        kind: "grids.custom-app",
        id: appId,
        baseId,
        name: "Request portal",
        startPageId: "home",
        pages: [
          {
            id: "home",
            title: "My requests",
            navigation: { visible: true, order: 0 },
            parameters: {},
            rows: [
              {
                id: "content",
                columns: [
                  {
                    id: "main",
                    span: 12,
                    blocks: [
                      { id: "intro", type: "markdown", markdown: "Welcome" },
                      {
                        id: "requests",
                        type: "records",
                        source: { kind: "view", viewId },
                        display: { kind: "table", columnIds: [fieldId] },
                        rowNavigate: {
                          kind: "navigate",
                          pageId: "request",
                          history: "push",
                          params: { request_id: { source: "ROW", path: "id" } },
                        },
                      },
                      {
                        id: "apply",
                        type: "form",
                        formId,
                        fixedValues: {},
                        onSuccessNavigate: {
                          kind: "navigate",
                          pageId: "request",
                          params: { request_id: { source: "RESULT", path: "recordId" } },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: "request",
            title: "Request detail",
            navigation: { visible: false, order: 10 },
            parameters: { request_id: { type: "record", tableId, required: true } },
            record: { tableId, id: { source: "PARAMS", path: "request_id" } },
            rows: [
              {
                id: "detail",
                columns: [
                  {
                    id: "main",
                    span: 12,
                    blocks: [
                      { id: "request-details", type: "record", fieldIds: [fieldId], editableFieldIds: [fieldId] },
                      { id: "discussion", type: "comments", title: "Updates" },
                      {
                        id: "actions",
                        type: "actions",
                        actions: [
                          {
                            id: "approve",
                            label: "Approve",
                            kind: "workflow",
                            launcherId,
                            inputs: { request: { source: "RECORD", path: "id" } },
                          },
                        ],
                      },
                      {
                        id: "follow-up",
                        type: "form",
                        formId,
                        fixedValues: { [relationFieldId]: { source: "PARAMS", path: "request_id" } },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const created = await apply(definition);
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.data.shortId).toHaveLength(5);
      expect(created.data.publishedDefinition).toBeNull();
      expect(created.data.draftCapabilities).toEqual({
        views: [{ viewId, tableId }],
        records: [{ pageId: "request", tableId, fieldIds: [fieldId], editableFieldIds: [fieldId] }],
        comments: [{ pageId: "request", blockId: "discussion", tableId }],
        forms: [
          {
            pageId: "home",
            blockId: "apply",
            formId,
            tableId,
            userInputFieldIds: [fieldId, relationFieldId].sort(),
            fixedFieldIds: [],
          },
          {
            pageId: "request",
            blockId: "follow-up",
            formId,
            tableId,
            userInputFieldIds: [fieldId, relationFieldId].sort(),
            fixedFieldIds: [relationFieldId],
          },
        ],
        workflowLaunchers: [
          { pageId: "request", blockId: "actions", actionId: "approve", launcherId, workflowId, revision: 1 },
        ],
      });
      expect((await plan(definition)).action).toBe("noop");

      const firstPublish = await publish(appId);
      expect(firstPublish.ok).toBe(true);
      if (!firstPublish.ok) return;
      expect(firstPublish.data.publishedDefinition?.name).toBe("Request portal");

      const [authUser] = await sql<Array<{ id: string }>>`SELECT id::text FROM auth.users ORDER BY id LIMIT 1`;
      if (!authUser) throw new Error("Custom App lifecycle test needs one auth user");
      const appGrant = await grantAccess({
        resourceType: "customApp",
        resourceId: appId,
        permission: "read",
        principal: { type: "user", userId: authUser.id },
      });
      expect(appGrant.ok).toBe(true);
      if (!appGrant.ok) throw new Error(appGrant.error.message);
      accessIds.push(appGrant.data.accessId);
      const executionClaim = {
        baseId,
        workflowId,
        principal: { userId: authUser.id, groupIds: [], serviceAccountId: null },
        authorization: {
          kind: "custom-app-action" as const,
          customAppId: appId,
          pageId: "request",
          blockId: "actions",
          actionId: "approve",
          revision: 1,
        },
        launcherId,
      };
      expect(await canExecuteWorkflow(executionClaim)).toBe(true);
      await sql`UPDATE grids.workflow_launchers SET enabled = FALSE WHERE id = ${launcherId}::uuid`;
      expect(await canExecuteWorkflow(executionClaim)).toBe(false);
      await sql`UPDATE grids.workflow_launchers SET enabled = TRUE WHERE id = ${launcherId}::uuid`;

      const updated = await apply({ ...definition, shortId: created.data.shortId, name: "Updated draft" });
      expect(updated.ok).toBe(true);
      expect((await get(appId))?.publishedDefinition?.name).toBe("Request portal");

      const secondPublish = await publish(appId);
      expect(secondPublish.ok).toBe(true);
      if (secondPublish.ok) expect(secondPublish.data.publishedDefinition?.name).toBe("Updated draft");

      const invalid = await compile({
        ...definition,
        id: testUuid(),
        pages: [
          {
            ...definition.pages[0],
            rows: [
              {
                ...definition.pages[0]!.rows[0],
                columns: [
                  {
                    ...definition.pages[0]!.rows[0]!.columns[0],
                    blocks: [
                      {
                        id: "invalid",
                        type: "records",
                        source: { kind: "view", viewId },
                        display: { kind: "table", columnIds: [testUuid()] },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(invalid.ok).toBe(false);

      const computedEdit = structuredClone(definition);
      const computedRecord = computedEdit.pages[1]!.rows[0]!.columns[0]!.blocks.find((block) => block.type === "record")!;
      if (computedRecord.type !== "record") throw new Error("Expected Record block");
      computedRecord.fieldIds.push(computedFieldId);
      computedRecord.editableFieldIds = [computedFieldId];
      const computedEditResult = await compile({ ...computedEdit, id: testUuid() });
      expect(computedEditResult.ok).toBe(false);
      if (!computedEditResult.ok) {
        expect(computedEditResult.diagnostics.some((diagnostic) => diagnostic.message.includes("not a writable record field"))).toBe(true);
      }

      const wrongRowTarget = await compile({
        ...definition,
        id: testUuid(),
        pages: [
          definition.pages[0],
          {
            ...definition.pages[1],
            parameters: { request_id: { type: "record", tableId: otherTableId, required: true } },
            record: { tableId: otherTableId, id: { source: "PARAMS", path: "request_id" } },
            rows: [
              {
                id: "detail",
                columns: [
                  {
                    id: "main",
                    span: 12,
                    blocks: [{ id: "request-details", type: "record", fieldIds: [otherFieldId], editableFieldIds: [] }],
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(wrongRowTarget.ok).toBe(false);
      if (!wrongRowTarget.ok) {
        expect(wrongRowTarget.diagnostics.some((diagnostic) => diagnostic.message.includes("source view table"))).toBe(true);
      }

      const wrongFixedTarget = await compile({
        ...definition,
        id: testUuid(),
        pages: [
          {
            ...definition.pages[0],
            rows: [
              {
                id: "home",
                columns: [{ id: "main", span: 12, blocks: [{ id: "intro", type: "markdown", markdown: "Welcome" }] }],
              },
            ],
          },
          {
            ...definition.pages[1],
            parameters: { request_id: { type: "record", tableId: otherTableId, required: true } },
            record: { tableId: otherTableId, id: { source: "PARAMS", path: "request_id" } },
            rows: [
              {
                id: "detail",
                columns: [
                  {
                    id: "main",
                    span: 12,
                    blocks: [
                      { id: "request-details", type: "record", fieldIds: [otherFieldId], editableFieldIds: [] },
                      {
                        id: "follow-up",
                        type: "form",
                        formId,
                        fixedValues: { [relationFieldId]: { source: "PARAMS", path: "request_id" } },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(wrongFixedTarget.ok).toBe(false);
      if (!wrongFixedTarget.ok) {
        expect(wrongFixedTarget.diagnostics.some((diagnostic) => diagnostic.message.includes("same table"))).toBe(true);
      }
    } finally {
      await deleteTestWorkflowScope(baseId);
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
    }
  });
});
