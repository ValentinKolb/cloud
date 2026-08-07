import { beforeAll, describe, expect } from "bun:test";
import { ok } from "@k2b/stdlib";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { Hono, type MiddlewareHandler } from "hono";
import type { CustomAppDefinition } from "../custom-apps/contracts";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { grantAccess } from "../service/access";
import { apply, publish } from "../service/custom-apps";
import type { CustomAppLauncherInvocation } from "../service/workflow-launcher-invocations";
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
    const launcherId = testUuid();
    const workflowId = testUuid();
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
                      { id: "record", type: "record", fieldIds: [fieldId], editableFieldIds: [fieldId] },
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

      let actionInvocation: CustomAppLauncherInvocation | null = null;
      const api = new Hono<AuthContext>().route(
        "/apps",
        createCustomAppsApi({
          requireAuthenticated: authenticateAs(userFor(authUser.id)),
          invokeCustomAppLauncher: async (input) => {
            actionInvocation = input as CustomAppLauncherInvocation;
            return ok({
              runId: testUuid(),
              workflowId,
              revision: "1",
              mode: "execute",
              channel: "customApp",
              created: true,
              status: "queued",
            });
          },
        }),
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

      const recordUrl = `/apps/runtime/${applied.data.shortId}/request/record/record?request_id=${body.recordId}`;
      const updatedRecord = await api.request(recordUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json", "If-Match": "1" },
        body: JSON.stringify({ values: { [fieldId]: "Certificate request updated" } }),
      });
      expect(updatedRecord.status).toBe(200);
      expect(await updatedRecord.json()).toMatchObject({ id: body.recordId, version: 2, data: { [fieldId]: "Certificate request updated" } });

      const rejectedField = await api.request(recordUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json", "If-Match": "2" },
        body: JSON.stringify({ values: { [testUuid()]: "not published" } }),
      });
      expect(rejectedField.status).toBe(400);

      const staleRecord = await api.request(recordUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json", "If-Match": "1" },
        body: JSON.stringify({ values: { [fieldId]: "stale update" } }),
      });
      expect(staleRecord.status).toBe(409);

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

      const actionDefinition = structuredClone(definition);
      actionDefinition.pages[1]!.rows[0]!.columns[0]!.blocks.push({
        id: "actions",
        type: "actions",
        actions: [
          {
            id: "approve",
            label: "Approve",
            kind: "workflow",
            launcherId,
            inputs: { request: { source: "RECORD", path: "id" } },
            visibleWhen: [
              {
                left: { source: "RECORD", path: `fields.${fieldId}` },
                operator: "eq",
                right: { source: "LITERAL", value: "Certificate request updated" },
              },
            ],
          },
        ],
      });
      const [stored] = await sql<Array<{ published_capabilities: Record<string, unknown> }>>`
        SELECT published_capabilities FROM grids.custom_apps WHERE id = ${appId}::uuid
      `;
      if (!stored) throw new Error("Published Custom App is missing");
      await sql`
        UPDATE grids.custom_apps
        SET published_definition = ${JSON.stringify(actionDefinition)}::jsonb,
            published_capabilities = ${JSON.stringify({
              ...stored.published_capabilities,
              workflowLaunchers: [
                { pageId: "request", blockId: "actions", actionId: "approve", launcherId, workflowId, revision: 1 },
              ],
            })}::jsonb
        WHERE id = ${appId}::uuid
      `;
      const actionResponse = await api.request(
        `/apps/runtime/${applied.data.shortId}/request/actions/actions/approve?request_id=${body.recordId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: testUuid() }),
        },
      );
      expect(actionResponse.status).toBe(202);
      expect(actionInvocation).toMatchObject({
        launcherId,
        expectedRevision: 1,
        inputs: { request: body.recordId },
        authorization: {
          kind: "custom-app-action",
          customAppId: appId,
          pageId: "request",
          blockId: "actions",
          actionId: "approve",
          revision: 1,
        },
      });

      const hiddenRecord = await api.request(recordUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json", "If-Match": "2" },
        body: JSON.stringify({ values: { [fieldId]: "Hidden" } }),
      });
      expect(hiddenRecord.status).toBe(200);
      actionInvocation = null;
      const hiddenAction = await api.request(
        `/apps/runtime/${applied.data.shortId}/request/actions/actions/approve?request_id=${body.recordId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: testUuid() }),
        },
      );
      expect(hiddenAction.status).toBe(404);
      expect(actionInvocation).toBeNull();
    } finally {
      await sql`DELETE FROM grids.audit_log WHERE base_id = ${baseId}::uuid`;
      await sql`DELETE FROM grids.record_event_outbox WHERE base_id = ${baseId}::uuid`;
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
    }
  });
});
