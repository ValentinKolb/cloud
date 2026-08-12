import { beforeAll, describe, expect, spyOn } from "bun:test";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { Hono } from "hono";
import type { CustomAppDefinition } from "../../custom-apps/contracts";
import { postgresTest, testShortId, testUuid } from "../../integration-test-utils";
import { migrate } from "../../migrate";
import { gridsService } from "../../service";
import { grantAccess } from "../../service/access";
import { apply, publish } from "../../service/custom-apps";
import customAppPage from "./page";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("published App SSR availability", () => {
  postgresTest("rejects unavailable pages and skips unavailable block data before rendering", async () => {
    const baseId = testUuid();
    const tableId = testUuid();
    const fieldId = testUuid();
    const viewId = testUuid();
    const appId = testUuid();
    const accessIds: string[] = [];
    const viewGet = spyOn(gridsService.view, "get");

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'SSR availability')`;
      await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name)
        VALUES (${tableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Requests')
      `;
      await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
        VALUES (${fieldId}::uuid, ${testShortId("F")}, ${tableId}::uuid, 'Subject', 'text', '{}'::jsonb, 0)
      `;
      await sql`
        INSERT INTO grids.views (id, short_id, table_id, name, source)
        VALUES (${viewId}::uuid, ${testShortId("V")}, ${tableId}::uuid, 'Private requests', ${`from table {${tableId}}`})
      `;

      const unavailable = `from table {${tableId}}\nlimit 1`;
      const definition: CustomAppDefinition = {
        schemaVersion: 3,
        kind: "grids.custom-app",
        id: appId,
        baseId,
        name: "SSR guard app",
        startPageId: "home",
        pages: [
          {
            id: "home",
            title: "Home",
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
                      {
                        id: "private-records",
                        type: "records",
                        searchable: true,
                        pageSize: 25,
                        title: "Unavailable records must not render",
                        source: { kind: "view", viewId },
                        display: { kind: "table", columnIds: [fieldId] },
                        availableWhen: { query: unavailable },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: "denied",
            title: "Denied page must not render",
            navigation: { visible: false, order: 1 },
            parameters: {},
            availableWhen: { query: unavailable },
            rows: [
              {
                id: "content",
                columns: [{ id: "main", span: 12, blocks: [{ id: "copy", type: "markdown", markdown: "Denied content" }] }],
              },
            ],
          },
        ],
      };

      const applied = await apply(definition);
      expect(applied.ok).toBe(true);
      if (!applied.ok) throw new Error(applied.error.message);
      const published = await publish(appId);
      expect(published.ok).toBe(true);
      const grant = await grantAccess({
        resourceType: "customApp",
        resourceId: appId,
        permission: "read",
        principal: { type: "public" },
      });
      expect(grant.ok).toBe(true);
      if (!grant.ok) throw new Error(grant.error.message);
      accessIds.push(grant.data.accessId);

      const app = new Hono<AuthContext>()
        .use("*", async (c, next) => {
          (c as unknown as { set: (key: string, value: unknown) => void }).set("runtime", { apps: [] });
          await next();
        })
        .get("/:shortId/:pageId", ...customAppPage);
      const home = await app.request(`/${applied.data.shortId}/home`);
      expect(home.status).toBe(200);
      expect(await home.text()).not.toContain("Unavailable records must not render");
      expect(viewGet).not.toHaveBeenCalled();

      const denied = await app.request(`/${applied.data.shortId}/denied`);
      expect(denied.status).toBe(404);
    } finally {
      viewGet.mockRestore();
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
    }
  });
});
