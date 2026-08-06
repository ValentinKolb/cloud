import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { CustomAppDefinitionSchema } from "../custom-apps/contracts";
import { postgresTest, testShortId } from "../integration-test-utils";
import { migrate } from "../migrate";
import {
  grantAccess,
  listCustomAppAccess,
  listDocumentTemplateAccess,
  listFormAccess,
  listTableAccess,
  listViewAccess,
} from "./access";
import { apply, compile, get, plan, publish } from "./custom-apps";

const CERTIFICATE = {
  appId: "10000000-0000-4000-8000-000000000101",
  baseId: "10000000-0000-4000-8000-000000000001",
  tableId: "10000000-0000-4000-8000-000000000201",
  fieldIds: [
    "10000000-0000-4000-8000-000000000301",
    "10000000-0000-4000-8000-000000000302",
    "10000000-0000-4000-8000-000000000303",
    "10000000-0000-4000-8000-000000000304",
  ],
  viewId: "10000000-0000-4000-8000-000000000401",
  formId: "10000000-0000-4000-8000-000000000501",
  documentTemplateId: "10000000-0000-4000-8000-000000000601",
  requesterGroupId: "10000000-0000-4000-8000-000000000701",
  responsibleGroupId: "10000000-0000-4000-8000-000000000702",
} as const;

const certificateDefinitionPath = `${import.meta.dir}/../../docs/custom-apps/certificate-requests.yaml`;

const loadCertificateDefinition = async () =>
  CustomAppDefinitionSchema.parse(Bun.YAML.parse(await Bun.file(certificateDefinitionPath).text()));

const cleanupCertificateFixture = async (): Promise<void> => {
  await sql`DELETE FROM grids.bases WHERE id = ${CERTIFICATE.baseId}::uuid`;
  await sql`
    DELETE FROM auth.access
    WHERE group_id IN (${CERTIFICATE.requesterGroupId}::uuid, ${CERTIFICATE.responsibleGroupId}::uuid)
  `;
  await sql`
    DELETE FROM auth.groups
    WHERE id IN (${CERTIFICATE.requesterGroupId}::uuid, ${CERTIFICATE.responsibleGroupId}::uuid)
  `;
};

const insertCertificateResources = async (): Promise<void> => {
  const [titleFieldId, descriptionFieldId, periodFieldId, statusFieldId] = CERTIFICATE.fieldIds;
  await sql`
    INSERT INTO auth.groups (id, cn, provider, name) VALUES
      (${CERTIFICATE.requesterGroupId}::uuid, 'custom-app-certificate-requesters', 'local', 'Certificate requesters'),
      (${CERTIFICATE.responsibleGroupId}::uuid, 'custom-app-certificate-responsible', 'local', 'Certificate responsible')
  `;
  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${CERTIFICATE.baseId}::uuid, ${testShortId("B")}, 'Certificate requests')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES (${CERTIFICATE.tableId}::uuid, ${testShortId("T")}, ${CERTIFICATE.baseId}::uuid, 'Requests', 0)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position) VALUES
      (${titleFieldId}::uuid, ${testShortId("F")}, ${CERTIFICATE.tableId}::uuid, 'Title', 'text', '{}'::jsonb, 0),
      (${descriptionFieldId}::uuid, ${testShortId("F")}, ${CERTIFICATE.tableId}::uuid, 'Description', 'longtext', '{}'::jsonb, 1),
      (${periodFieldId}::uuid, ${testShortId("F")}, ${CERTIFICATE.tableId}::uuid, 'Contribution period', 'text', '{}'::jsonb, 2),
      (${statusFieldId}::uuid, ${testShortId("F")}, ${CERTIFICATE.tableId}::uuid, 'Status', 'text', '{}'::jsonb, 3)
  `;
  await sql`
    INSERT INTO grids.views (id, short_id, table_id, name, source)
    VALUES (
      ${CERTIFICATE.viewId}::uuid,
      ${testShortId("V")},
      ${CERTIFICATE.tableId}::uuid,
      'My requests',
      ${`from table {${CERTIFICATE.tableId}}`}
    )
  `;
  await sql`
    INSERT INTO grids.forms (id, short_id, table_id, name, config, is_active, position)
    VALUES (
      ${CERTIFICATE.formId}::uuid,
      ${testShortId("M")},
      ${CERTIFICATE.tableId}::uuid,
      'Certificate request',
      ${JSON.stringify({
        title: "Request a certificate",
        fields: [titleFieldId, descriptionFieldId, periodFieldId].map((fieldId) => ({ kind: "user_input", fieldId })),
      })}::jsonb,
      true,
      0
    )
  `;
  await sql`
    INSERT INTO grids.document_templates (id, short_id, table_id, name, source, html)
    VALUES (
      ${CERTIFICATE.documentTemplateId}::uuid,
      ${testShortId("D")},
      ${CERTIFICATE.tableId}::uuid,
      'Certificate',
      ${`from table {${CERTIFICATE.tableId}}`},
      '<h1>Certificate</h1>'
    )
  `;
};

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("Custom App Golden fixtures", () => {
  test("keeps the certificate request fixture structurally valid", async () => {
    const definition = await loadCertificateDefinition();
    expect(definition.id).toBe(CERTIFICATE.appId);
    expect(definition.baseId).toBe(CERTIFICATE.baseId);
  });

  postgresTest("executes the certificate request fixture through the complete lifecycle", async () => {
    await cleanupCertificateFixture();
    try {
      await insertCertificateResources();
      const definition = await loadCertificateDefinition();

      const validation = await compile(definition);
      expect(validation.ok).toBe(true);
      if (!validation.ok) throw new Error(validation.diagnostics.map((item) => item.message).join("; "));
      expect(validation.compiled.capabilities).toEqual({
        views: [{ viewId: CERTIFICATE.viewId, tableId: CERTIFICATE.tableId }],
        insights: [],
        records: [
          {
            pageId: "request",
            tableId: CERTIFICATE.tableId,
            fieldIds: [...CERTIFICATE.fieldIds],
            editableFieldIds: [],
          },
        ],
        forms: [
          {
            pageId: "apply",
            blockId: "request-form",
            formId: CERTIFICATE.formId,
            tableId: CERTIFICATE.tableId,
            userInputFieldIds: CERTIFICATE.fieldIds.slice(0, 3),
            fixedFieldIds: [],
          },
        ],
        comments: [{ pageId: "request", blockId: "comments", tableId: CERTIFICATE.tableId }],
        documents: [
          {
            pageId: "request",
            blockId: "request",
            tableId: CERTIFICATE.tableId,
            templateIds: [CERTIFICATE.documentTemplateId],
          },
        ],
        workflowLaunchers: [],
      });

      const planned = await plan(definition);
      expect(planned).toEqual({ valid: true, diagnostics: [], action: "create", changes: ["app"] });
      expect(await plan(definition)).toEqual(planned);

      const created = await apply(definition);
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error.message);
      expect(created.data.shortId).toHaveLength(5);

      const exportedYaml = Bun.YAML.stringify(created.data.draftDefinition);
      const exported = CustomAppDefinitionSchema.parse(Bun.YAML.parse(exportedYaml));
      expect(exported).toEqual({ ...definition, shortId: created.data.shortId });
      expect((await plan(exported)).action).toBe("noop");

      const reapplied = await apply(exported);
      expect(reapplied.ok).toBe(true);
      if (!reapplied.ok) throw new Error(reapplied.error.message);
      expect(reapplied.data.updatedAt).toBe(created.data.updatedAt);
      const [stored] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM grids.custom_apps WHERE id = ${CERTIFICATE.appId}::uuid
      `;
      expect(stored?.count).toBe(1);

      const grants = [
        {
          resourceType: "customApp",
          resourceId: CERTIFICATE.appId,
          principal: { type: "group", groupId: CERTIFICATE.requesterGroupId },
          permission: "read",
        },
        {
          resourceType: "table",
          resourceId: CERTIFICATE.tableId,
          principal: { type: "group", groupId: CERTIFICATE.requesterGroupId },
          permission: "read",
          recordScope: { kind: "created_by" },
        },
        {
          resourceType: "view",
          resourceId: CERTIFICATE.viewId,
          principal: { type: "group", groupId: CERTIFICATE.requesterGroupId },
          permission: "read",
          recordScope: { kind: "created_by" },
        },
        {
          resourceType: "form",
          resourceId: CERTIFICATE.formId,
          principal: { type: "group", groupId: CERTIFICATE.requesterGroupId },
          permission: "write",
        },
        {
          resourceType: "documentTemplate",
          resourceId: CERTIFICATE.documentTemplateId,
          principal: { type: "group", groupId: CERTIFICATE.requesterGroupId },
          permission: "read",
        },
        {
          resourceType: "customApp",
          resourceId: CERTIFICATE.appId,
          principal: { type: "group", groupId: CERTIFICATE.responsibleGroupId },
          permission: "read",
        },
        {
          resourceType: "table",
          resourceId: CERTIFICATE.tableId,
          principal: { type: "group", groupId: CERTIFICATE.responsibleGroupId },
          permission: "write",
          recordScope: { kind: "all" },
        },
        {
          resourceType: "view",
          resourceId: CERTIFICATE.viewId,
          principal: { type: "group", groupId: CERTIFICATE.responsibleGroupId },
          permission: "read",
          recordScope: { kind: "all" },
        },
        {
          resourceType: "documentTemplate",
          resourceId: CERTIFICATE.documentTemplateId,
          principal: { type: "group", groupId: CERTIFICATE.responsibleGroupId },
          permission: "write",
        },
      ] satisfies Array<Parameters<typeof grantAccess>[0]>;
      for (const grant of grants) {
        const result = await grantAccess(grant);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
      }

      expect(await listCustomAppAccess(CERTIFICATE.appId)).toHaveLength(2);
      expect(await listTableAccess(CERTIFICATE.tableId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            principal: { type: "group", groupId: CERTIFICATE.requesterGroupId },
            permission: "read",
            recordScope: { kind: "created_by" },
          }),
          expect.objectContaining({
            principal: { type: "group", groupId: CERTIFICATE.responsibleGroupId },
            permission: "write",
            recordScope: { kind: "all" },
          }),
        ]),
      );
      expect(await listViewAccess(CERTIFICATE.viewId)).toHaveLength(2);
      expect(await listFormAccess(CERTIFICATE.formId)).toEqual([
        expect.objectContaining({
          principal: { type: "group", groupId: CERTIFICATE.requesterGroupId },
          permission: "write",
        }),
      ]);
      expect(await listDocumentTemplateAccess(CERTIFICATE.documentTemplateId)).toHaveLength(2);

      const published = await publish(CERTIFICATE.appId);
      expect(published.ok).toBe(true);
      if (!published.ok) throw new Error(published.error.message);
      expect(published.data.publishedDefinition).toEqual(exported);
      expect(published.data.publishedCapabilities).toEqual(validation.compiled.capabilities);
      expect((await get(CERTIFICATE.appId))?.publishedCapabilities).toEqual(validation.compiled.capabilities);
    } finally {
      await cleanupCertificateFixture();
    }
  });
});
