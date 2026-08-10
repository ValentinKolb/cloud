import { beforeAll, describe, expect } from "bun:test";
import { ok } from "@k2b/stdlib";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { Hono, type MiddlewareHandler } from "hono";
import type { CustomAppDefinition } from "../custom-apps/contracts";
import { customAppViewSourceHash } from "../custom-apps/insight-source";
import { buildCustomAppRuntimeContext } from "../custom-apps/runtime-context";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { grantAccess } from "../service/access";
import { compileCustomAppQuery } from "../service/custom-app-query";
import { executePublishedCustomAppQuery } from "../service/custom-app-runtime-query";
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
    const hiddenFieldId = testUuid();
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
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, required, position) VALUES
          (${fieldId}::uuid, ${testShortId("F")}, ${tableId}::uuid, 'Subject', 'text', '{}'::jsonb, TRUE, 0),
          (${hiddenFieldId}::uuid, ${testShortId("H")}, ${tableId}::uuid, 'Internal source', 'text', '{}'::jsonb, FALSE, 1)
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
        schemaVersion: 2,
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

      const appGrant = await grantAccess({
        resourceType: "customApp",
        resourceId: appId,
        permission: "read",
        principal: { type: "public" },
      });
      expect(appGrant.ok).toBe(true);
      if (!appGrant.ok) throw new Error(appGrant.error.message);
      accessIds.push(appGrant.data.accessId);

      let actionInvocation: CustomAppLauncherInvocation | null = null;
      const publicApi = new Hono<AuthContext>().route(
        "/apps",
        createCustomAppsApi({
          requireAuthenticated: async (c) => c.json({ message: "Authentication required" }, 401),
        }),
      );
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
      const response = await publicApi.request(`/apps/runtime/${applied.data.shortId}/home/apply/submit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `custom-app-${baseId}` },
        body: JSON.stringify({ [fieldId]: "Certificate request" }),
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("X-RateLimit-Limit")).toBe("3");
      const body = (await response.json()) as { recordId: string; navigateTo: string };
      expect(body.navigateTo).toBe(`/apps/${applied.data.shortId}/request?request_id=${body.recordId}`);

      const [record] = await sql<Array<{ value: string }>>`
        SELECT data ->> ${fieldId} AS value FROM grids.records WHERE id = ${body.recordId}::uuid
      `;
      expect(record?.value).toBe("Certificate request");

      await sql`
        UPDATE grids.forms
        SET config = ${{
          fields: [
            { kind: "user_input", fieldId, required: true },
            { kind: "form_value", fieldId: hiddenFieldId, value: "injected-after-publish" },
          ],
        }}::jsonb
        WHERE id = ${formId}::uuid
      `;
      const driftedSubmit = await publicApi.request(`/apps/runtime/${applied.data.shortId}/home/apply/submit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `custom-app-drift-${baseId}` },
        body: JSON.stringify({ [fieldId]: "Must not be written" }),
      });
      expect(driftedSubmit.status).toBe(404);
      const [afterDrift] = await sql<Array<{ count: number; hidden_count: number }>>`
        SELECT
          count(*)::int AS count,
          count(*) FILTER (WHERE data ? ${hiddenFieldId})::int AS hidden_count
        FROM grids.records
        WHERE table_id = ${tableId}::uuid AND deleted_at IS NULL
      `;
      expect(afterDrift).toEqual({ count: 1, hidden_count: 0 });
      await sql`
        UPDATE grids.forms
        SET config = ${{ fields: [{ kind: "user_input", fieldId, required: true }] }}::jsonb
        WHERE id = ${formId}::uuid
      `;

      const recordUrl = `/apps/runtime/${applied.data.shortId}/request/record/record?request_id=${body.recordId}`;
      const anonymousRecordEdit = await publicApi.request(recordUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json", "If-Match": "1" },
        body: JSON.stringify({ values: { [fieldId]: "Anonymous edit" } }),
      });
      expect(anonymousRecordEdit.status).toBe(401);
      const updatedRecord = await api.request(recordUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json", "If-Match": "1" },
        body: JSON.stringify({ values: { [fieldId]: "Certificate request updated" } }),
      });
      expect(updatedRecord.status).toBe(200);
      expect(await updatedRecord.json()).toMatchObject({
        id: body.recordId,
        version: 2,
        data: { [fieldId]: "Certificate request updated" },
      });

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
      expect((await publicApi.request(commentsUrl)).status).toBe(401);
      const createdComment = await api.request(commentsUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `custom-app-${baseId}` },
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
      const actionAvailability = `from table {${tableId}}\nwhere record.id = @params.request_id and {${fieldId}} = 'Certificate request updated'\nlimit 1`;
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
            availableWhen: { query: actionAvailability },
          },
        ],
      });
      const authenticatedUser = userFor(authUser.id);
      const actionContext = buildCustomAppRuntimeContext({
        access: { actor: { kind: "user", user: authenticatedUser }, accessSubject: { type: "user", userId: authUser.id } },
        app: { id: appId, shortId: applied.data.shortId, name: definition.name },
        base: { id: baseId, name: "Custom App API" },
        page: actionDefinition.pages[1]!,
        pageUrl: `/apps/${applied.data.shortId}/request?request_id=${body.recordId}`,
        pageParams: { request_id: body.recordId },
        dateConfig: { timeZone: "UTC" },
      });
      const compiledActionAvailability = await compileCustomAppQuery({
        baseId,
        source: actionAvailability,
        context: actionContext.query,
      });
      if (!compiledActionAvailability.ok) throw new Error(compiledActionAvailability.error);
      const actionCapability = {
        target: "action" as const,
        pageId: "request",
        blockId: "actions",
        actionId: "approve",
        sourceHash: customAppViewSourceHash(baseId, actionAvailability),
        planHash: compiledActionAvailability.data.planHash,
        tableIds: [tableId],
      };
      const [stored] = await sql<Array<{ published_capabilities: Record<string, unknown> }>>`
        SELECT published_capabilities FROM grids.custom_apps WHERE id = ${appId}::uuid
      `;
      if (!stored) throw new Error("Published Custom App is missing");
      await sql`
        UPDATE grids.custom_apps
        SET published_definition = ${JSON.stringify(actionDefinition)}::jsonb,
            published_capabilities = ${JSON.stringify({
              ...stored.published_capabilities,
              availability: [...((stored.published_capabilities.availability as unknown[]) ?? []), actionCapability],
              workflowLaunchers: [{ pageId: "request", blockId: "actions", actionId: "approve", launcherId, workflowId, revision: 1 }],
            })}::jsonb
        WHERE id = ${appId}::uuid
      `;
      const anonymousAction = await publicApi.request(
        `/apps/runtime/${applied.data.shortId}/request/actions/actions/approve?request_id=${body.recordId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: testUuid() }),
        },
      );
      expect(anonymousAction.status).toBe(401);
      const directAvailability = await executePublishedCustomAppQuery({
        baseId,
        source: actionAvailability,
        capability: actionCapability,
        context: actionContext.query,
        signal: new AbortController().signal,
        timeZone: "UTC",
        viewer: { userId: authUser.id, userGroups: [], isAdmin: true },
        maxRows: 1,
        maxResultBytes: 64_000,
      });
      if (!directAvailability.ok) throw new Error(directAvailability.diagnostics[0]?.message);
      expect(directAvailability.ok).toBe(true);
      expect(directAvailability.rows).toHaveLength(1);
      const changedPlanCapability = await executePublishedCustomAppQuery({
        baseId,
        source: actionAvailability,
        capability: { ...actionCapability, planHash: "0".repeat(64) },
        context: actionContext.query,
        signal: new AbortController().signal,
        timeZone: "UTC",
        viewer: { userId: authUser.id, userGroups: [] },
        maxRows: 1,
        maxResultBytes: 64_000,
      });
      expect(changedPlanCapability).toEqual({
        ok: false,
        diagnostics: [{ message: "This published data source no longer matches its query plan capability snapshot." }],
      });
      const changedTableCapability = await executePublishedCustomAppQuery({
        baseId,
        source: actionAvailability,
        capability: { ...actionCapability, tableIds: [baseId] },
        context: actionContext.query,
        signal: new AbortController().signal,
        timeZone: "UTC",
        viewer: { userId: authUser.id, userGroups: [] },
        maxRows: 1,
        maxResultBytes: 64_000,
      });
      expect(changedTableCapability).toEqual({
        ok: false,
        diagnostics: [{ message: "This published data source no longer matches its table capability snapshot." }],
      });
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

      const blockAvailability = `from table {${tableId}}\nwhere {${fieldId}} = 'No matching form record'\nlimit 1`;
      const unavailableFormDefinition = structuredClone(actionDefinition);
      const unavailableForm = unavailableFormDefinition.pages[0]!.rows[0]!.columns[0]!.blocks[0]!;
      unavailableForm.availableWhen = { query: blockAvailability };
      const compiledBlockAvailability = await compileCustomAppQuery({
        baseId,
        source: blockAvailability,
        context: actionContext.query,
      });
      if (!compiledBlockAvailability.ok) throw new Error(compiledBlockAvailability.error);
      const [actionCapabilities] = await sql<Array<{ published_capabilities: Record<string, unknown> }>>`
        SELECT published_capabilities FROM grids.custom_apps WHERE id = ${appId}::uuid
      `;
      if (!actionCapabilities) throw new Error("Published Custom App capabilities are missing");
      const unavailableFormCapabilities = {
        ...actionCapabilities.published_capabilities,
        availability: [
          ...((actionCapabilities.published_capabilities.availability as unknown[]) ?? []),
          {
            target: "block",
            pageId: "home",
            blockId: "apply",
            sourceHash: customAppViewSourceHash(baseId, blockAvailability),
            planHash: compiledBlockAvailability.data.planHash,
            tableIds: [tableId],
          },
        ],
      };
      await sql`
        UPDATE grids.custom_apps
        SET published_definition = ${unavailableFormDefinition}::jsonb,
            published_capabilities = ${unavailableFormCapabilities}::jsonb
        WHERE id = ${appId}::uuid
      `;
      const unavailableFormResponse = await publicApi.request(`/apps/runtime/${applied.data.shortId}/home/apply/submit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `custom-app-block-${baseId}` },
        body: JSON.stringify({ [fieldId]: "Must not be created" }),
      });
      expect(unavailableFormResponse.status).toBe(404);

      const pageAvailability = `from table {${tableId}}\nwhere {${fieldId}} = 'No matching page record'\nlimit 1`;
      const unavailablePageDefinition = structuredClone(unavailableFormDefinition);
      unavailablePageDefinition.pages[0]!.availableWhen = { query: pageAvailability };
      const compiledPageAvailability = await compileCustomAppQuery({
        baseId,
        source: pageAvailability,
        context: actionContext.query,
      });
      if (!compiledPageAvailability.ok) throw new Error(compiledPageAvailability.error);
      await sql`
        UPDATE grids.custom_apps
        SET published_definition = ${unavailablePageDefinition}::jsonb,
            published_capabilities = ${{
              ...unavailableFormCapabilities,
              availability: [
                ...((unavailableFormCapabilities.availability as unknown[]) ?? []),
                {
                  target: "page",
                  pageId: "home",
                  sourceHash: customAppViewSourceHash(baseId, pageAvailability),
                  planHash: compiledPageAvailability.data.planHash,
                  tableIds: [tableId],
                },
              ],
            }}::jsonb
        WHERE id = ${appId}::uuid
      `;
      const unavailablePageResponse = await publicApi.request(`/apps/runtime/${applied.data.shortId}/home/apply/submit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `custom-app-page-${baseId}` },
        body: JSON.stringify({ [fieldId]: "Must not be created" }),
      });
      expect(unavailablePageResponse.status).toBe(404);

      await sql`
        UPDATE grids.custom_apps
        SET published_definition = ${{ schemaVersion: 1, kind: "grids.custom-app" }}::jsonb
        WHERE id = ${appId}::uuid
      `;
      const legacyRuntime = await publicApi.request(`/apps/runtime/${applied.data.shortId}/home/apply/submit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `custom-app-v1-${baseId}` },
        body: JSON.stringify({ [fieldId]: "Must not be created" }),
      });
      expect(legacyRuntime.status).toBe(404);
    } finally {
      await sql`DELETE FROM grids.audit_log WHERE base_id = ${baseId}::uuid`;
      await sql`DELETE FROM grids.record_event_outbox WHERE base_id = ${baseId}::uuid`;
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
    }
  });
});
