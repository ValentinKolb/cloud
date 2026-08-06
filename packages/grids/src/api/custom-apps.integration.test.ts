import { beforeAll, describe, expect } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { Hono, type MiddlewareHandler } from "hono";
import type { CustomAppDefinition } from "../custom-apps/contracts";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { grantAccess } from "../service/access";
import { apply, publish } from "../service/custom-apps";
import { createCustomAppsApi } from "./custom-apps";

const authenticateAs =
  (user: User): MiddlewareHandler<AuthContext> =>
  async (c, next) => {
    c.set("actor", { kind: "user", user });
    c.set("accessSubject", { type: "user", userId: user.id });
    c.set("user", user);
    await next();
  };

const userFor = (id: string): User => ({
  id,
  uid: `custom-app-${id}`,
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Custom",
  sn: "App",
  displayName: "Custom App",
  mail: `custom-app-${id}@example.test`,
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
  ipa: null,
});

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("Custom App Form runtime", () => {
  postgresTest("submits through the published Form capability and replace-navigates to the created record", async () => {
    const baseId = testUuid();
    const tableId = testUuid();
    const fieldId = testUuid();
    const formId = testUuid();
    const appId = testUuid();
    const [authUser] = await sql<Array<{ id: string }>>`SELECT id::text FROM auth.users ORDER BY id LIMIT 1`;
    if (!authUser) throw new Error("Custom App API integration test needs one auth user");
    const accessIds: string[] = [];
    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'Custom App API')`;
      await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name)
        VALUES (${tableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Requests')
      `;
      await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, required, position)
        VALUES (${fieldId}::uuid, ${testShortId("F")}, ${tableId}::uuid, 'Subject', 'text', '{}'::jsonb, TRUE, 0)
      `;
      await sql`
        INSERT INTO grids.forms (id, short_id, table_id, name, config, is_active, position)
        VALUES (
          ${formId}::uuid,
          ${testShortId("M")},
          ${tableId}::uuid,
          'Apply',
          ${{ fields: [{ kind: "user_input", fieldId, required: true }] }}::jsonb,
          TRUE,
          0
        )
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
            title: "Apply",
            navigation: { visible: true, order: 0 },
            parameters: {},
            rows: [
              {
                id: "main",
                columns: [
                  {
                    id: "content",
                    span: 12,
                    blocks: [
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
            title: "Request",
            navigation: { visible: false, order: 10 },
            parameters: { request_id: { type: "record", tableId, required: true } },
            record: { tableId, id: { source: "PARAMS", path: "request_id" } },
            rows: [
              {
                id: "main",
                columns: [
                  {
                    id: "content",
                    span: 12,
                    blocks: [
                      { id: "record", type: "record", fieldIds: [fieldId] },
                      { id: "discussion", type: "comments" },
                    ],
                  },
                ],
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

      for (const grant of [
        { resourceType: "customApp" as const, resourceId: appId, permission: "read" as const },
        { resourceType: "form" as const, resourceId: formId, permission: "write" as const },
        { resourceType: "table" as const, resourceId: tableId, permission: "write" as const },
      ]) {
        const result = await grantAccess({ ...grant, principal: { type: "user", userId: authUser.id } });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        accessIds.push(result.data.accessId);
      }

      const api = new Hono<AuthContext>().route(
        "/apps",
        createCustomAppsApi({ requireAuthenticated: authenticateAs(userFor(authUser.id)) }),
      );
      const response = await api.request(`/apps/runtime/${applied.data.shortId}/home/apply/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [fieldId]: "Certificate request" }),
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { recordId: string; navigateTo: string };
      expect(body.navigateTo).toBe(`/apps/${applied.data.shortId}/request?request_id=${body.recordId}`);

      const [record] = await sql<Array<{ value: string }>>`
        SELECT data ->> ${fieldId} AS value FROM grids.records WHERE id = ${body.recordId}::uuid
      `;
      expect(record?.value).toBe("Certificate request");

      const commentsUrl = `/apps/runtime/${applied.data.shortId}/request/discussion/comments?request_id=${body.recordId}`;
      const createdComment = await api.request(commentsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Ready for review" }),
      });
      expect(createdComment.status).toBe(201);
      const comment = (await createdComment.json()) as { id: string; body: string };
      expect(comment.body).toBe("Ready for review");

      const listedComments = await api.request(commentsUrl);
      expect(listedComments.status).toBe(200);
      const page = (await listedComments.json()) as { items: Array<{ id: string; body: string }>; nextCursor: string | null };
      expect(page).toMatchObject({ items: [{ id: comment.id, body: "Ready for review" }], nextCursor: null });
    } finally {
      await sql`DELETE FROM grids.audit_log WHERE base_id = ${baseId}::uuid`;
      await sql`DELETE FROM grids.record_event_outbox WHERE base_id = ${baseId}::uuid`;
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
    }
  });
});
