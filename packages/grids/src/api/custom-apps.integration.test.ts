import { beforeAll, describe, expect } from "bun:test";
import { ok } from "@k2b/stdlib";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { Hono, type MiddlewareHandler } from "hono";
import type { DslQueryPreviewResponse } from "../contracts";
import { CustomAppCapabilitiesSchema, type CustomAppDefinition } from "../custom-apps/contracts";
import { customAppViewSourceHash } from "../custom-apps/insight-source";
import { buildCustomAppRuntimeContext } from "../custom-apps/runtime-context";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { grantAccess } from "../service/access";
import { compileCustomAppQuery } from "../service/custom-app-query";
import { executePublishedCustomAppQuery } from "../service/custom-app-runtime-query";
import { apply, getPublishedByShortId, publish } from "../service/custom-apps";
import { parseJsonbRow } from "../service/jsonb";
import type { CustomAppLauncherInvocation, ScannerLauncherInvocation } from "../service/workflow-launcher-invocations";
import type { GridsWorkflowAuthorization, GridsWorkflowRunScope } from "../service/workflow-runs";
import type { GridsWorkflowPrincipal, GridsWorkflowRun } from "../workflows/contracts";
import { createCustomAppsApi } from "./custom-apps";

const authenticateAs =
  (user: User): MiddlewareHandler<AuthContext> =>
  async (c, next) => {
    c.set("actor", { kind: "user", user });
    c.set("accessSubject", { type: "user", userId: user.id });
    c.set("user", user);
    await next();
  };

const authenticateAsDelegatedServiceAccount = (user: User, serviceAccountId: string): MiddlewareHandler<AuthContext> => {
  const credentialId = testUuid();
  return async (c, next) => {
    c.set("actor", {
      kind: "service_account",
      serviceAccount: {
        id: serviceAccountId,
        name: "Grids App API",
        kind: "user_delegated",
        status: "active",
        delegatedUserId: user.id,
        appId: null,
        resourceType: null,
        resourceId: null,
        createdBy: user.id,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      delegatedUser: user,
      scopes: ["grids:write"],
      credentialId,
    });
    c.set("accessSubject", { type: "user", userId: user.id, delegatedByServiceAccountId: serviceAccountId });
    c.set("user", user);
    await next();
  };
};

const userFor = (id: string): User => ({
  id,
  uid: `custom-app-${id}`,
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Custom",
  sn: "App",
  displayName: "Grids App",
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

describe("Grids App Form runtime", () => {
  postgresTest(
    "submits through the published Form capability and replace-navigates to the created record",
    async () => {
      const baseId = testUuid();
      const tableId = testUuid();
      const fieldId = testUuid();
      const hiddenFieldId = testUuid();
      const suppliedFieldId = testUuid();
      const formId = testUuid();
      const viewId = testUuid();
      const documentTemplateId = testUuid();
      const otherDocumentTemplateId = testUuid();
      const appId = testUuid();
      const launcherId = testUuid();
      const workflowId = testUuid();
      const [authUser] = await sql<Array<{ id: string }>>`SELECT id::text FROM auth.users ORDER BY id LIMIT 1`;
      if (!authUser) throw new Error("Grids App API integration test needs one auth user");
      const accessIds: string[] = [];
      try {
        await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'Grids App API')`;
        await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name)
        VALUES (${tableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Requests')
      `;
        await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, required, default_value, position) VALUES
          (${fieldId}::uuid, ${testShortId("F")}, ${tableId}::uuid, 'Subject', 'text', '{}'::jsonb, TRUE, NULL, 0),
          (${hiddenFieldId}::uuid, ${testShortId("H")}, ${tableId}::uuid, 'Internal source', 'text', '{}'::jsonb, FALSE, NULL, 1),
          (${suppliedFieldId}::uuid, ${testShortId("S")}, ${tableId}::uuid, 'Channel', 'text', '{}'::jsonb, FALSE, ${JSON.stringify("Web default")}::jsonb, 2)
      `;
        await sql`
        INSERT INTO grids.views (id, short_id, table_id, name, source, ui)
        VALUES (
          ${viewId}::uuid,
          ${testShortId("V")},
          ${tableId}::uuid,
          'Request search',
          ${`from table {${tableId}}\nselect {${fieldId}}`},
          ${JSON.stringify({ displayConfig: { mode: "cards", cards: { fieldIds: [suppliedFieldId] } } })}::jsonb
        )
      `;
        await sql`
        INSERT INTO grids.forms (id, short_id, table_id, name, config, is_active, position)
        VALUES (
          ${formId}::uuid,
          ${testShortId("M")},
          ${tableId}::uuid,
          'Apply',
          ${{
            fields: [
              { kind: "user_input", fieldId, required: true },
              { kind: "user_input", fieldId: suppliedFieldId },
            ],
          }}::jsonb,
          TRUE,
          0
        )
      `;
        await sql`
        INSERT INTO grids.document_templates (id, short_id, table_id, name, source, html)
        VALUES
          (${documentTemplateId}::uuid, ${testShortId("D")}, ${tableId}::uuid, 'Certificate', 'from table Requests', '<p>Certificate</p>'),
          (${otherDocumentTemplateId}::uuid, ${testShortId("E")}, ${tableId}::uuid, 'Internal certificate', 'from table Requests', '<p>Internal</p>')
      `;

        const definition: CustomAppDefinition = {
          schemaVersion: 3,
          kind: "grids.custom-app",
          id: appId,
          baseId,
          name: "Request portal",
          startPageId: "home",
          sidebar: {
            actions: [
              {
                id: "new-request",
                kind: "form",
                label: "New request",
                tone: "success",
                formId,
                fixedValues: { [suppliedFieldId]: { source: "LITERAL", value: "Sidebar" } },
                onSuccessNavigate: {
                  kind: "navigate",
                  pageId: "request",
                  params: { request_id: { source: "RESULT", path: "recordId" } },
                },
              },
            ],
          },
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
                          fixedValues: { [suppliedFieldId]: { source: "LITERAL", value: "App portal" } },
                          onSuccessNavigate: {
                            kind: "navigate",
                            pageId: "request",
                            params: { request_id: { source: "RESULT", path: "recordId" } },
                          },
                        },
                        {
                          id: "requests",
                          type: "records",
                          source: { kind: "view", viewId },
                          display: { kind: "cards" },
                          searchable: true,
                          pageSize: 25,
                          rowNavigate: {
                            kind: "navigate",
                            pageId: "request",
                            history: "push",
                            params: { request_id: { source: "ROW", path: "id" } },
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
                        {
                          id: "record",
                          type: "record",
                          fieldIds: [fieldId],
                          editableFieldIds: [fieldId],
                          documents: { templateIds: [documentTemplateId] },
                        },
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
        let scannerInvocation: ScannerLauncherInvocation | null = null;
        const renderDocumentRunPdf = async () => ok({ pdf: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf" as const });
        const publicApi = new Hono<AuthContext>().route(
          "/apps",
          createCustomAppsApi({
            requireAuthenticated: async (c) => c.json({ message: "Authentication required" }, 401),
            renderDocumentRunPdf,
          }),
        );
        const api = new Hono<AuthContext>().route(
          "/apps",
          createCustomAppsApi({
            loadOptionalActor: authenticateAs(userFor(authUser.id)),
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
            invokeScannerLauncher: async (input) => {
              scannerInvocation = input as ScannerLauncherInvocation;
              return ok({
                runId: testUuid(),
                workflowId,
                revision: "1",
                mode: "execute",
                channel: "scanner",
                created: true,
                status: "queued",
              });
            },
            renderDocumentRunPdf,
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

        const [record] = await sql<Array<{ value: string; supplied: string }>>`
        SELECT data ->> ${fieldId} AS value, data ->> ${suppliedFieldId} AS supplied
        FROM grids.records WHERE id = ${body.recordId}::uuid
      `;
        expect(record?.value).toBe("Certificate request");
        expect(record?.supplied).toBe("App portal");

        const cardsResponse = await publicApi.request(`/apps/runtime/${applied.data.shortId}/home/requests/records`, {
          headers: { "x-forwarded-for": `custom-app-cards-${baseId}` },
        });
        expect(cardsResponse.status).toBe(200);
        const cardsBody = (await cardsResponse.json()) as {
          cards?: { displayConfig: { mode: string }; records: Array<{ id: string; data: Record<string, unknown> }> };
        };
        expect(cardsBody.cards?.displayConfig.mode).toBe("cards");
        expect(cardsBody.cards?.records.find((item) => item.id === body.recordId)?.data).toEqual({ [suppliedFieldId]: "App portal" });

        const searchedCardsResponse = await publicApi.request(
          `/apps/runtime/${applied.data.shortId}/home/requests/records?q=App%20portal`,
          { headers: { "x-forwarded-for": `custom-app-card-search-${baseId}` } },
        );
        expect(searchedCardsResponse.status).toBe(200);
        const searchedCardsBody = (await searchedCardsResponse.json()) as { rows: Array<{ recordId?: string }> };
        expect(searchedCardsBody.rows.some((item) => item.recordId === body.recordId)).toBe(true);

        const sidebarResponse = await publicApi.request(`/apps/runtime/${applied.data.shortId}/sidebar/forms/new-request/submit`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `custom-app-sidebar-${baseId}` },
          body: JSON.stringify({ [fieldId]: "Sidebar request" }),
        });
        expect(sidebarResponse.status).toBe(201);
        const sidebarBody = (await sidebarResponse.json()) as { recordId: string; navigateTo: string };
        expect(sidebarBody.navigateTo).toBe(`/apps/${applied.data.shortId}/request?request_id=${sidebarBody.recordId}`);
        const [sidebarRecord] = await sql<Array<{ value: string; supplied: string }>>`
          SELECT data ->> ${fieldId} AS value, data ->> ${suppliedFieldId} AS supplied
          FROM grids.records WHERE id = ${sidebarBody.recordId}::uuid
        `;
        expect(sidebarRecord).toEqual({ value: "Sidebar request", supplied: "Sidebar" });

        const snapshotId = testUuid();
        const documentRunId = testUuid();
        const otherDocumentRunId = testUuid();
        const otherRecordId = testUuid();
        await sql`
        INSERT INTO grids.records (id, table_id, data, created_by, updated_by)
        VALUES (
          ${otherRecordId}::uuid,
          ${tableId}::uuid,
          ${{ [fieldId]: "Another request", [suppliedFieldId]: "App portal" }}::jsonb,
          ${authUser.id}::uuid,
          ${authUser.id}::uuid
        )
      `;
        await sql`
        INSERT INTO grids.record_snapshots (id, base_id, table_id, record_id, root, graph)
        VALUES (
          ${snapshotId}::uuid,
          ${baseId}::uuid,
          ${tableId}::uuid,
          ${body.recordId}::uuid,
          '{}'::jsonb,
          '{}'::jsonb
        )
      `;
        await sql`
        INSERT INTO grids.document_runs (
          id, short_id, template_id, snapshot_id, base_id, table_id, record_id,
          document_number, filename, template_snapshot, render_data
        ) VALUES (
          ${documentRunId}::uuid,
          ${testShortId("R")},
          ${documentTemplateId}::uuid,
          ${snapshotId}::uuid,
          ${baseId}::uuid,
          ${tableId}::uuid,
          ${body.recordId}::uuid,
          'CERT-1',
          'certificate.pdf',
          '{}'::jsonb,
          '{}'::jsonb
        )
      `;
        await sql`
        INSERT INTO grids.document_runs (
          id, short_id, template_id, snapshot_id, base_id, table_id, record_id,
          document_number, filename, template_snapshot, render_data
        ) VALUES (
          ${otherDocumentRunId}::uuid,
          ${testShortId("Q")},
          ${otherDocumentTemplateId}::uuid,
          ${snapshotId}::uuid,
          ${baseId}::uuid,
          ${tableId}::uuid,
          ${body.recordId}::uuid,
          'INTERNAL-1',
          'internal-certificate.pdf',
          '{}'::jsonb,
          '{}'::jsonb
        )
      `;
        const documentResponse = await publicApi.request(
          `/apps/runtime/${applied.data.shortId}/request/record/documents/${documentRunId}/download?request_id=${body.recordId}`,
          { headers: { "x-forwarded-for": `custom-app-document-${baseId}` } },
        );
        expect(documentResponse.status).toBe(200);
        expect(documentResponse.headers.get("content-type")).toBe("application/pdf");
        expect(documentResponse.headers.get("X-Grids-Document-Run-Id")).toBe(documentRunId);
        expect(new Uint8Array(await documentResponse.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
        expect(
          (
            await publicApi.request(
              `/apps/runtime/${applied.data.shortId}/request/record/documents/${documentRunId}/download?request_id=${otherRecordId}`,
              { headers: { "x-forwarded-for": `custom-app-document-record-${baseId}` } },
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await publicApi.request(
              `/apps/runtime/${applied.data.shortId}/request/record/documents/${otherDocumentRunId}/download?request_id=${body.recordId}`,
              { headers: { "x-forwarded-for": `custom-app-document-template-${baseId}` } },
            )
          ).status,
        ).toBe(404);

        const fixedOverride = await publicApi.request(`/apps/runtime/${applied.data.shortId}/home/apply/submit`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `custom-app-override-${baseId}` },
          body: JSON.stringify({ [fieldId]: "Override", [suppliedFieldId]: "Browser value" }),
        });
        expect(fixedOverride.status).toBe(400);

        await sql`
        UPDATE grids.forms
        SET config = ${{
          fields: [
            { kind: "user_input", fieldId, required: true },
            { kind: "user_input", fieldId: suppliedFieldId },
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
        expect(afterDrift).toEqual({ count: 3, hidden_count: 0 });
        await sql`
        UPDATE grids.forms
        SET config = ${{
          fields: [
            { kind: "user_input", fieldId, required: true },
            { kind: "user_input", fieldId: suppliedFieldId },
          ],
        }}::jsonb
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
        actionDefinition.sidebar!.actions.push({
          id: "approve-global",
          kind: "workflow",
          label: "Approve request",
          tone: "default",
          launcherId,
          inputs: { request: { source: "LITERAL", value: body.recordId } },
        });
        const viewSource = `from table {${tableId}}\nselect {${fieldId}}`;
        actionDefinition.pages[1]!.rows[0]!.columns[0]!.blocks.push({
          id: "request-view",
          type: "records",
          searchable: true,
          pageSize: 25,
          source: { kind: "view", viewId },
          display: { kind: "table", columnIds: [fieldId] },
        });
        const rowSource = `from table {${tableId}}`;
        actionDefinition.pages[1]!.rows[0]!.columns[0]!.blocks.push({
          id: "requests",
          type: "records",
          searchable: true,
          pageSize: 25,
          source: { kind: "gql", query: rowSource },
          display: { kind: "table", columnIds: [] },
          rowActions: [
            {
              id: "approve-row",
              label: "Approve row",
              showLabel: true,
              kind: "workflow",
              launcherId,
              inputs: { request: { source: "ROW", path: "id" } },
            },
          ],
        });
        const authenticatedUser = userFor(authUser.id);
        const actionContext = buildCustomAppRuntimeContext({
          access: { actor: { kind: "user", user: authenticatedUser }, accessSubject: { type: "user", userId: authUser.id } },
          app: { id: appId, shortId: applied.data.shortId, name: definition.name },
          base: { id: baseId, name: "Grids App API" },
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
        const compiledRowSource = await compileCustomAppQuery({ baseId, source: rowSource, context: actionContext.query });
        if (!compiledRowSource.ok) throw new Error(compiledRowSource.error);
        const compiledViewSource = await compileCustomAppQuery({ baseId, source: viewSource, context: actionContext.query });
        if (!compiledViewSource.ok) throw new Error(compiledViewSource.error);
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
        if (!stored) throw new Error("Published Grids App is missing");
        await sql`
        UPDATE grids.custom_apps
        SET published_definition = ${JSON.stringify(actionDefinition)}::jsonb,
            published_capabilities = ${JSON.stringify({
              ...stored.published_capabilities,
              availability: [...((stored.published_capabilities.availability as unknown[]) ?? []), actionCapability],
              recordQueries: [
                ...((stored.published_capabilities.recordQueries as unknown[]) ?? []),
                {
                  pageId: "request",
                  blockId: "requests",
                  primaryTableId: tableId,
                  planHash: compiledRowSource.data.planHash,
                  tableIds: [tableId],
                },
              ],
              views: [
                ...((stored.published_capabilities.views as unknown[]) ?? []),
                {
                  viewId,
                  tableId,
                  sourceHash: customAppViewSourceHash(tableId, viewSource),
                  planHash: compiledViewSource.data.planHash,
                  tableIds: [tableId],
                },
              ],
              workflowLaunchers: [
                { sidebarActionId: "approve-global", launcherId, workflowId, revision: 1 },
                { pageId: "request", blockId: "actions", actionId: "approve", launcherId, workflowId, revision: 1 },
                { pageId: "request", blockId: "requests", actionId: "approve-row", launcherId, workflowId, revision: 1 },
              ],
            })}::jsonb
        WHERE id = ${appId}::uuid
      `;
        expect(await getPublishedByShortId(applied.data.shortId)).not.toBeNull();
        const searchableRecords = await sql<Array<{ id: string; subject: string }>>`
        INSERT INTO grids.records (id, table_id, data, created_by, updated_by)
        SELECT
          gen_random_uuid(),
          ${tableId}::uuid,
          jsonb_build_object(
            ${fieldId}::text,
            CASE WHEN generated.index = 129 THEN 'Unique searchable needle' ELSE 'Generated request ' || generated.index::text END
          ),
          ${authUser.id}::uuid,
          ${authUser.id}::uuid
        FROM generate_series(0, 129) AS generated(index)
        RETURNING id::text, data->>${fieldId}::text AS subject
      `;
        const searchableRecordId = searchableRecords.find((record) => record.subject === "Unique searchable needle")?.id;
        if (!searchableRecordId) throw new Error("Search fixture record is missing");
        const recordsUrl = `/apps/runtime/${applied.data.shortId}/request/requests/records?request_id=${body.recordId}`;
        const firstRecordsResponse = await api.request(recordsUrl);
        expect(firstRecordsResponse.status).toBe(200);
        const firstRecords = (await firstRecordsResponse.json()) as Extract<DslQueryPreviewResponse, { ok: true }>;
        expect(firstRecords.rows).toHaveLength(25);
        expect(firstRecords.page?.nextCursor).toBeString();
        const secondRecordsResponse = await api.request(`${recordsUrl}&cursor=${encodeURIComponent(firstRecords.page?.nextCursor ?? "")}`);
        expect(secondRecordsResponse.status).toBe(200);
        const secondRecords = (await secondRecordsResponse.json()) as Extract<DslQueryPreviewResponse, { ok: true }>;
        expect(secondRecords.rows).toHaveLength(25);
        expect(new Set([...firstRecords.rows, ...secondRecords.rows].map((row) => row.recordId)).size).toBe(50);

        const searchedRecordsResponse = await api.request(`${recordsUrl}&q=${encodeURIComponent("Unique searchable needle")}`);
        expect(searchedRecordsResponse.status).toBe(200);
        const searchedRecords = (await searchedRecordsResponse.json()) as Extract<DslQueryPreviewResponse, { ok: true }>;
        expect(searchedRecords.rows.map((row) => row.recordId)).toEqual([searchableRecordId]);
        const injectionResponse = await api.request(`${recordsUrl}&q=${encodeURIComponent("%' OR TRUE --")}`);
        expect(injectionResponse.status).toBe(200);
        const injectionResult = (await injectionResponse.json()) as Extract<DslQueryPreviewResponse, { ok: true }>;
        expect(injectionResult.rows).toHaveLength(0);
        const viewRecordsUrl = `/apps/runtime/${applied.data.shortId}/request/request-view/records?request_id=${body.recordId}`;
        const searchedViewResponse = await api.request(`${viewRecordsUrl}&q=${encodeURIComponent("Unique searchable needle")}`);
        expect(searchedViewResponse.status).toBe(200);
        const searchedView = (await searchedViewResponse.json()) as Extract<DslQueryPreviewResponse, { ok: true }>;
        expect(searchedView.rows.map((row) => row.recordId)).toEqual([searchableRecordId]);
        expect((await api.request(`${recordsUrl}&cursor=not-a-signed-cursor`)).status).toBe(400);

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
        const sidebarActionResponse = await api.request(`/apps/runtime/${applied.data.shortId}/sidebar/actions/approve-global`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: testUuid() }),
        });
        expect(sidebarActionResponse.status).toBe(202);
        expect(actionInvocation).toMatchObject({
          launcherId,
          expectedRevision: 1,
          inputs: { request: body.recordId },
          authorization: {
            kind: "custom-app-sidebar-action",
            customAppId: appId,
            actionId: "approve-global",
            revision: 1,
          },
        });

        const statusRuns = new Map<
          string,
          {
            principal: GridsWorkflowPrincipal;
            authorization: GridsWorkflowAuthorization;
            launcherId: string;
            channel: "customApp" | "scanner";
          }
        >();
        const createStatusApi = (serviceAccountId: string) =>
          new Hono<AuthContext>().route(
            "/apps",
            createCustomAppsApi({
              requireAuthenticated: authenticateAsDelegatedServiceAccount(authenticatedUser, serviceAccountId),
              invokeCustomAppLauncher: async (input) => {
                const invocation = input as CustomAppLauncherInvocation;
                const runId = testUuid();
                if (!invocation.authorization) throw new Error("Grids App action authorization is missing");
                statusRuns.set(runId, {
                  principal: invocation.principal,
                  authorization: invocation.authorization,
                  launcherId: invocation.launcherId,
                  channel: "customApp",
                });
                return ok({
                  runId,
                  workflowId,
                  revision: "1",
                  mode: "execute",
                  channel: "customApp",
                  created: true,
                  status: "queued",
                });
              },
              invokeScannerLauncher: async (input) => {
                const invocation = input as ScannerLauncherInvocation;
                const runId = testUuid();
                if (!invocation.authorization) throw new Error("Grids App scanner authorization is missing");
                statusRuns.set(runId, {
                  principal: invocation.principal,
                  authorization: invocation.authorization,
                  launcherId: invocation.launcherId,
                  channel: "scanner",
                });
                return ok({
                  runId,
                  workflowId,
                  revision: "1",
                  mode: "execute",
                  channel: "scanner",
                  created: true,
                  status: "queued",
                });
              },
              getWorkflowRunScope: async (runId): Promise<GridsWorkflowRunScope | null> => {
                const accepted = statusRuns.get(runId);
                return accepted
                  ? {
                      runId,
                      baseId,
                      workflow: { id: workflowId, shortId: testShortId("W"), name: "Approve request" },
                      principal: accepted.principal,
                      authorization: accepted.authorization,
                      launcherId: accepted.launcherId,
                    }
                  : null;
              },
              getWorkflowRun: async (runId): Promise<GridsWorkflowRun | null> => {
                const accepted = statusRuns.get(runId);
                return accepted
                  ? {
                      id: runId,
                      workflowId,
                      launcherId: accepted.launcherId,
                      baseId,
                      workflowRevision: 1,
                      mode: "execute",
                      channel: accepted.channel,
                      actorUserId: accepted.principal.userId,
                      serviceAccountId: accepted.principal.serviceAccountId,
                      inputs: {},
                      status: "succeeded",
                      result: null,
                      error: null,
                      resultMessage: "Approved",
                      createdAt: "2026-01-01T00:00:00.000Z",
                      startedAt: "2026-01-01T00:00:00.000Z",
                      finishedAt: "2026-01-01T00:00:01.000Z",
                    }
                  : null;
              },
            }),
          );
        const firstServiceAccountApi = createStatusApi(testUuid());
        const secondServiceAccountApi = createStatusApi(testUuid());
        const delegatedActionResponse = await firstServiceAccountApi.request(
          `/apps/runtime/${applied.data.shortId}/request/actions/actions/approve?request_id=${body.recordId}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ operationId: testUuid() }),
          },
        );
        expect(delegatedActionResponse.status).toBe(202);
        const delegatedAction = (await delegatedActionResponse.json()) as { statusUrl: string };
        const statusPath = delegatedAction.statusUrl.replace(/^\/api\/grids/, "");
        const ownStatus = await firstServiceAccountApi.request(statusPath);
        expect(ownStatus.status).toBe(200);
        expect(await ownStatus.json()).toEqual({ status: "succeeded", message: "Approved" });
        expect((await secondServiceAccountApi.request(statusPath)).status).toBe(404);

        actionInvocation = null;
        const rowActionUrl = `/apps/runtime/${applied.data.shortId}/request/requests/row-actions/approve-row?request_id=${body.recordId}`;
        const searchedRowAction = await api.request(rowActionUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operationId: testUuid(),
            rowId: searchableRecordId,
            search: "Unique searchable needle",
          }),
        });
        expect(searchedRowAction.status).toBe(202);
        expect(actionInvocation).toMatchObject({ inputs: { request: searchableRecordId } });
        actionInvocation = null;
        const rowActionResponse = await api.request(rowActionUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: testUuid(), rowId: body.recordId }),
        });
        expect(rowActionResponse.status).toBe(202);
        expect(actionInvocation).toMatchObject({
          inputs: { request: body.recordId },
          authorization: { blockId: "requests", actionId: "approve-row" },
        });
        actionInvocation = null;

        const scannerBlock = { id: "returns", type: "scanner" as const, launcherId };
        actionDefinition.pages[0]!.rows[0]!.columns[0]!.blocks.push(scannerBlock);
        const scannerConfigHash = "a".repeat(64);
        const [scannerStored] = await sql<Array<{ published_capabilities: Record<string, unknown> }>>`
        SELECT published_capabilities FROM grids.custom_apps WHERE id = ${appId}::uuid
      `;
        if (!scannerStored) throw new Error("Published Grids App is missing");
        const scannerCapabilities = CustomAppCapabilitiesSchema.safeParse({
          ...parseJsonbRow(scannerStored.published_capabilities, {}),
          scannerLaunchers: [
            {
              pageId: "home",
              blockId: scannerBlock.id,
              launcherId,
              workflowId,
              revision: 1,
              configHash: scannerConfigHash,
            },
          ],
        });
        expect(scannerCapabilities.success, scannerCapabilities.success ? undefined : scannerCapabilities.error.message).toBe(true);
        if (!scannerCapabilities.success) throw new Error(scannerCapabilities.error.message);
        await sql`
        UPDATE grids.custom_apps
        SET published_definition = ${JSON.stringify(actionDefinition)}::jsonb,
            published_capabilities = ${JSON.stringify(scannerCapabilities.data)}::jsonb
        WHERE id = ${appId}::uuid
      `;
        const scannerPublished = await getPublishedByShortId(applied.data.shortId);
        expect(scannerPublished?.publishedDefinition).not.toBeNull();
        expect(scannerPublished?.publishedCapabilities?.scannerLaunchers).toHaveLength(1);
        const scannerPath = `/apps/runtime/${applied.data.shortId}/home/${scannerBlock.id}/scanner`;
        expect(
          (
            await publicApi.request(scannerPath, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ operationId: testUuid(), expectedRevision: 1, scannedText: "ITEM-42", inputs: {} }),
            })
          ).status,
        ).toBe(401);
        const scannerResponse = await api.request(scannerPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: testUuid(), expectedRevision: 1, scannedText: "ITEM-42", inputs: {} }),
        });
        expect(scannerResponse.status).toBe(202);
        expect(scannerInvocation).toMatchObject({
          launcherId,
          expectedRevision: 1,
          scannedText: "ITEM-42",
          authorization: {
            kind: "custom-app-scanner",
            customAppId: appId,
            pageId: "home",
            blockId: scannerBlock.id,
            revision: 1,
            configHash: scannerConfigHash,
          },
        });
        const delegatedScannerResponse = await firstServiceAccountApi.request(scannerPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: testUuid(), expectedRevision: 1, scannedText: "ITEM-43", inputs: {} }),
        });
        expect(delegatedScannerResponse.status).toBe(202);
        const delegatedScanner = (await delegatedScannerResponse.json()) as { statusUrl: string };
        const scannerStatusPath = delegatedScanner.statusUrl.replace(/^\/api\/grids/, "");
        expect((await firstServiceAccountApi.request(scannerStatusPath)).status).toBe(200);
        expect((await secondServiceAccountApi.request(scannerStatusPath)).status).toBe(404);
        const forgedRowResponse = await api.request(rowActionUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: testUuid(), rowId: testUuid() }),
        });
        expect(forgedRowResponse.status).toBe(404);
        expect(actionInvocation).toBeNull();

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
        if (!actionCapabilities) throw new Error("Published Grids App capabilities are missing");
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
        await sql`DELETE FROM grids.document_runs WHERE base_id = ${baseId}::uuid`;
        await sql`DELETE FROM grids.record_snapshots WHERE base_id = ${baseId}::uuid`;
        await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
        for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
      }
    },
    30_000,
  );
});
