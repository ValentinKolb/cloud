import { beforeAll, describe, expect } from "bun:test";
import { sql } from "bun";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { listForBase } from "./base-catalog";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

const grant = async (userId: string, permission: "none" | "read" | "write" | "admin"): Promise<string> => {
  const id = testUuid();
  await sql`
    INSERT INTO auth.access (id, user_id, permission)
    VALUES (${id}::uuid, ${userId}::uuid, ${permission}::auth.permission_level)
  `;
  return id;
};

describe("base catalog integration", () => {
  postgresTest("returns only authorized live resources without leaking parent fields", async () => {
    const userId = testUuid();
    const baseId = testUuid();
    const readableTableId = testUuid();
    const deniedTableId = testUuid();
    const formOnlyTableId = testUuid();
    const documentOnlyTableId = testUuid();
    const deletedTableId = testUuid();
    const formId = testUuid();
    const templateId = testUuid();
    const deletedTemplateId = testUuid();
    try {
      await sql`
        INSERT INTO auth.users (id, uid, provider, profile, display_name, given_name, sn)
        VALUES (${userId}::uuid, ${`catalog-${userId}`}, 'local', 'user', 'Catalog User', 'Catalog', 'User')
      `;
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'Catalog')`;
      await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name, position, deleted_at) VALUES
          (${readableTableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Readable', 0, NULL),
          (${deniedTableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Denied', 1, NULL),
          (${formOnlyTableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Form only', 2, NULL),
          (${documentOnlyTableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Document only', 3, NULL),
          (${deletedTableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Deleted', 4, now())
      `;
      for (const [position, tableId] of [readableTableId, deniedTableId, formOnlyTableId, documentOnlyTableId, deletedTableId].entries()) {
        await sql`
          INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
          VALUES (${testUuid()}::uuid, ${testShortId("F")}, ${tableId}::uuid, ${`Field ${position}`}, 'text', '{}'::jsonb, ${position})
        `;
      }
      await sql`
        INSERT INTO grids.forms (id, short_id, table_id, name, config, is_active)
        VALUES (${formId}::uuid, ${testShortId("F")}, ${formOnlyTableId}::uuid, 'Submit', '{}'::jsonb, TRUE)
      `;
      await sql`
        INSERT INTO grids.document_templates (id, short_id, table_id, name, source, html, deleted_at) VALUES
          (${templateId}::uuid, ${testShortId("D")}, ${documentOnlyTableId}::uuid, 'Invoice', 'from table "Document only"', '<p>Invoice</p>', NULL),
          (${deletedTemplateId}::uuid, ${testShortId("D")}, ${documentOnlyTableId}::uuid, 'Old invoice', 'from table "Document only"', '<p>Old</p>', now())
      `;

      const readableAccess = await grant(userId, "read");
      const deniedAccess = await grant(userId, "none");
      const formAccess = await grant(userId, "write");
      const templateAccess = await grant(userId, "read");
      const deletedTableAccess = await grant(userId, "admin");
      const deletedTemplateAccess = await grant(userId, "admin");
      await sql`INSERT INTO grids.table_access (table_id, access_id) VALUES (${readableTableId}::uuid, ${readableAccess}::uuid)`;
      await sql`INSERT INTO grids.table_access (table_id, access_id) VALUES (${deniedTableId}::uuid, ${deniedAccess}::uuid)`;
      await sql`INSERT INTO grids.table_access (table_id, access_id) VALUES (${deletedTableId}::uuid, ${deletedTableAccess}::uuid)`;
      await sql`INSERT INTO grids.form_access (form_id, access_id) VALUES (${formId}::uuid, ${formAccess}::uuid)`;
      await sql`INSERT INTO grids.document_template_access (template_id, access_id) VALUES (${templateId}::uuid, ${templateAccess}::uuid)`;
      await sql`
        INSERT INTO grids.document_template_access (template_id, access_id)
        VALUES (${deletedTemplateId}::uuid, ${deletedTemplateAccess}::uuid)
      `;

      const catalog = await listForBase({ baseId, userId, userGroups: [] });
      expect(catalog.tables.map((table) => table.id)).toEqual([readableTableId]);
      expect(catalog.tableLevels).toEqual({ [readableTableId]: "read" });
      expect(Object.keys(catalog.fieldsByTable)).toEqual(expect.arrayContaining([readableTableId, formOnlyTableId]));
      expect(catalog.fieldsByTable[deniedTableId]).toBeUndefined();
      expect(catalog.fieldsByTable[documentOnlyTableId]).toBeUndefined();
      expect(catalog.formTables.map((table) => table.id)).toEqual([formOnlyTableId]);
      expect(catalog.sidebarForms.map(({ form }) => form.id)).toEqual([formId]);
      expect(catalog.documentTemplateTables.map((table) => table.id)).toEqual([documentOnlyTableId]);
      expect(catalog.sidebarDocumentTemplates.map(({ template }) => template.id)).toEqual([templateId]);
      expect(catalog.documentTemplateLevels).toEqual({ [templateId]: "read" });
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });
});
