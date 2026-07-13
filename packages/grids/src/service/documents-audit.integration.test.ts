import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { logAudit } from "./audit";
import { createDocumentRun, createRecordSnapshot, getTemplate, updateRunMetadata } from "./documents";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type Fixture = {
  actorId: string;
  baseId: string;
  tableId: string;
  fieldId: string;
  recordId: string;
  templateId: string;
};

const createFixture = (): Fixture => ({
  actorId: uuid(),
  baseId: uuid(),
  tableId: uuid(),
  fieldId: uuid(),
  recordId: uuid(),
  templateId: uuid(),
});

const insertFixture = async (fixture: Fixture): Promise<void> => {
  await sql`
    INSERT INTO auth.users (id, uid, provider, profile, display_name, given_name, sn)
    VALUES (${fixture.actorId}::uuid, ${`document-audit-${fixture.actorId}`}, 'local', 'user', 'Document Audit', 'Document', 'Audit')
  `;
  await sql`
    INSERT INTO grids.bases (id, short_id, name, created_by)
    VALUES (${fixture.baseId}::uuid, ${shortId("B")}, 'Document audit integration', ${fixture.actorId}::uuid)
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES (${fixture.tableId}::uuid, ${shortId("T")}, ${fixture.baseId}::uuid, 'Invoices', 0)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
    VALUES (${fixture.fieldId}::uuid, ${shortId("F")}, ${fixture.tableId}::uuid, 'Name', 'text', '{}'::jsonb, 0)
  `;
  await sql`
    INSERT INTO grids.records (id, table_id, data, created_by, updated_by)
    VALUES (
      ${fixture.recordId}::uuid,
      ${fixture.tableId}::uuid,
      ${{ [fixture.fieldId]: "Invoice 1" }}::jsonb,
      ${fixture.actorId}::uuid,
      ${fixture.actorId}::uuid
    )
  `;
  await sql`
    INSERT INTO grids.document_templates (
      id, short_id, table_id, name, source, html, number_template, filename_template, created_by, updated_by
    )
    VALUES (
      ${fixture.templateId}::uuid,
      ${shortId("D")},
      ${fixture.tableId}::uuid,
      'Invoice',
      ${`from table {${fixture.tableId}} limit 1`},
      '<p>Invoice</p>',
      '{{ template.shortId }}-{{ run.shortId }}',
      '{{ document.number }}.pdf',
      ${fixture.actorId}::uuid,
      ${fixture.actorId}::uuid
    )
  `;
};

const cleanupFixture = async (fixture: Fixture): Promise<void> => {
  await sql`DELETE FROM grids.audit_log WHERE base_id = ${fixture.baseId}::uuid`;
  await sql`DELETE FROM grids.document_runs WHERE base_id = ${fixture.baseId}::uuid`;
  await sql`DELETE FROM grids.record_snapshots WHERE base_id = ${fixture.baseId}::uuid`;
  await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
  await sql`DELETE FROM auth.users WHERE id = ${fixture.actorId}::uuid`;
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("document audit integration", () => {
  postgresTest("audits snapshots, direct document generation, and metadata changes", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const template = await getTemplate(fixture.templateId);
      if (!template) throw new Error("Fixture template missing");

      const snapshot = await createRecordSnapshot({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        actorId: fixture.actorId,
        canReadRelatedTable: async () => true,
      });
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) throw new Error(snapshot.error.message);

      const run = await createDocumentRun({
        template,
        snapshot: snapshot.data,
        renderData: { record: snapshot.data.root, snapshot: snapshot.data },
        actorId: fixture.actorId,
        tags: ["draft"],
      });
      expect(run.ok).toBe(true);
      if (!run.ok) throw new Error(run.error.message);

      const updated = await updateRunMetadata(run.data.id, { filename: "invoice-final.pdf", tags: ["final", "paid"] }, fixture.actorId);
      expect(updated.ok).toBe(true);
      if (!updated.ok) throw new Error(updated.error.message);

      const unchanged = await updateRunMetadata(run.data.id, { filename: "invoice-final.pdf", tags: ["final", "paid"] }, fixture.actorId);
      expect(unchanged.ok).toBe(true);

      const rows = await sql<Array<{ action: string; user_id: string | null; diff: Record<string, { old: unknown; new: unknown }> }>>`
        SELECT action, user_id::text, diff
        FROM grids.audit_log
        WHERE base_id = ${fixture.baseId}::uuid
          AND action IN ('record_snapshot.created', 'document.generated', 'document.metadata.updated')
        ORDER BY created_at ASC, id ASC
      `;
      expect(rows.map((row) => row.action)).toEqual(["record_snapshot.created", "document.generated", "document.metadata.updated"]);
      expect(rows.every((row) => row.user_id === fixture.actorId)).toBe(true);

      const snapshotAudit = rows.find((row) => row.action === "record_snapshot.created");
      expect(snapshotAudit?.diff.snapshotId).toEqual({ old: null, new: snapshot.data.id });
      expect(snapshotAudit?.diff.recordVersion).toEqual({ old: null, new: 1 });

      const generationAudit = rows.find((row) => row.action === "document.generated");
      expect(generationAudit?.diff.documentRunId).toEqual({ old: null, new: run.data.id });
      expect(generationAudit?.diff.snapshotId).toEqual({ old: null, new: snapshot.data.id });
      expect(generationAudit?.diff.filename).toEqual({ old: null, new: run.data.filename });
      expect(generationAudit?.diff.tags).toEqual({ old: null, new: ["draft"] });

      const metadataAudit = rows.find((row) => row.action === "document.metadata.updated");
      expect(metadataAudit?.diff.filename).toEqual({ old: run.data.filename, new: "invoice-final.pdf" });
      expect(metadataAudit?.diff.tags).toEqual({ old: ["draft"], new: ["final", "paid"] });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("does not duplicate the workflow runtime generation audit", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const workflowId = uuid();
      const workflowRunId = uuid();
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, compiled, enabled, position, owner_user_id)
        VALUES (
          ${workflowId}::uuid,
          ${shortId("W")},
          ${fixture.baseId}::uuid,
          'Generate invoice',
          'steps: []',
          ${{ inputs: {}, triggers: { api: {} }, steps: [] }}::jsonb,
          TRUE,
          0,
          ${fixture.actorId}::uuid
        )
      `;
      await sql`
        INSERT INTO grids.workflow_runs (id, workflow_id, base_id, actor_user_id, workflow_definition, workflow_catalog, trigger_kind, status)
        VALUES (
          ${workflowRunId}::uuid, ${workflowId}::uuid, ${fixture.baseId}::uuid, ${fixture.actorId}::uuid,
          '{"triggers":{"api":{}},"steps":[]}'::jsonb,
          '{"tables":[],"fieldsByTable":{},"templates":[],"emailTemplates":[]}'::jsonb, 'api', 'running'
        )
      `;

      const template = await getTemplate(fixture.templateId);
      if (!template) throw new Error("Fixture template missing");
      const snapshot = await createRecordSnapshot({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        actorId: fixture.actorId,
        canReadRelatedTable: async () => true,
      });
      if (!snapshot.ok) throw new Error(snapshot.error.message);
      const run = await createDocumentRun({
        template,
        snapshot: snapshot.data,
        renderData: { record: snapshot.data.root, snapshot: snapshot.data },
        actorId: fixture.actorId,
        workflowRunId,
      });
      expect(run.ok).toBe(true);
      if (!run.ok) throw new Error(run.error.message);

      await logAudit({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        userId: fixture.actorId,
        action: "workflow.document.generated",
        diff: { workflowDocumentGenerate: { old: null, new: { workflowRunId, documentRunId: run.data.id } } },
      });

      const rows = await sql<Array<{ action: string }>>`
        SELECT action
        FROM grids.audit_log
        WHERE base_id = ${fixture.baseId}::uuid
          AND action IN ('document.generated', 'workflow.document.generated')
      `;
      expect(rows.map((row) => row.action)).toEqual(["workflow.document.generated"]);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
