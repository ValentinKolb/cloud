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
import "../_components/ssr-test-plugin";

const { default: customAppPage } = await import("./page");

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("published App SSR availability", () => {
  postgresTest("rejects unavailable pages and skips unavailable block data before rendering", async () => {
    const baseId = testUuid();
    const tableId = testUuid();
    const fieldId = testUuid();
    const viewId = testUuid();
    const basePublicId = testShortId("B");
    const tablePublicId = testShortId("T");
    const fieldPublicId = testShortId("F");
    const viewPublicId = testShortId("V");
    const appPublicId = testShortId("A");
    const accessIds: string[] = [];
    const viewGet = spyOn(gridsService.view, "get");

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${basePublicId}, 'SSR availability')`;
      await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name)
        VALUES (${tableId}::uuid, ${tablePublicId}, ${baseId}::uuid, 'Requests')
      `;
      await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
        VALUES (${fieldId}::uuid, ${fieldPublicId}, ${tableId}::uuid, 'Subject', 'text', '{}'::jsonb, 0)
      `;
      await sql`
        INSERT INTO grids.views (id, short_id, table_id, name, source)
        VALUES (${viewId}::uuid, ${viewPublicId}, ${tableId}::uuid, 'Private requests', ${`from table {${tableId}}`})
      `;

      const unavailable = `from table {${tablePublicId}}\nlimit 1`;
      const definition: CustomAppDefinition = {
        schemaVersion: 5,
        kind: "grids.custom-app",
        id: appPublicId,
        baseId: basePublicId,
        name: "SSR guard app",
        startPageId: "home",
        pages: [
          {
            id: "home",
            title: "Home",
            navigation: { visible: true },
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
                        source: { kind: "view", viewId: viewPublicId },
                        display: { kind: "table", columnIds: [fieldPublicId] },
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
            navigation: { visible: false },
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
      const published = await publish(applied.data.id);
      expect(published.ok).toBe(true);
      const grant = await grantAccess({
        resourceType: "customApp",
        resourceId: applied.data.id,
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
      const home = await app.request(`/${appPublicId}/home`);
      expect(home.status).toBe(200);
      expect(await home.text()).not.toContain("Unavailable records must not render");
      expect(viewGet).not.toHaveBeenCalled();

      const denied = await app.request(`/${appPublicId}/denied`);
      expect(denied.status).toBe(404);
    } finally {
      viewGet.mockRestore();
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
    }
  });
});
