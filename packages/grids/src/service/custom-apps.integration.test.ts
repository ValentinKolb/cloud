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
      expect(created.data.draftCapabilities).toEqual({ views: [{ viewId, tableId }] });
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
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
