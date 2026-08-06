import { beforeAll, describe, expect } from "bun:test";
import { sql } from "bun";
import type { CustomAppDefinition } from "../custom-apps/contracts";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { apply, compile, get, plan, publish } from "./custom-apps";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("Custom App lifecycle", () => {
  postgresTest("compiles references and keeps draft changes isolated until publish", async () => {
    const baseId = testUuid();
    const tableId = testUuid();
    const viewId = testUuid();
    const fieldId = testUuid();
    const relationFieldId = testUuid();
    const formId = testUuid();
    const otherTableId = testUuid();
    const otherFieldId = testUuid();
    const appId = testUuid();
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
                      { id: "request-details", type: "record", fieldIds: [fieldId] },
                      { id: "discussion", type: "comments", title: "Updates" },
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
        records: [{ pageId: "request", tableId, fieldIds: [fieldId] }],
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
      });
      expect((await plan(definition)).action).toBe("noop");

      const firstPublish = await publish(appId);
      expect(firstPublish.ok).toBe(true);
      if (!firstPublish.ok) return;
      expect(firstPublish.data.publishedDefinition?.name).toBe("Request portal");

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
                    blocks: [{ id: "request-details", type: "record", fieldIds: [otherFieldId] }],
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
                      { id: "request-details", type: "record", fieldIds: [otherFieldId] },
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
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
