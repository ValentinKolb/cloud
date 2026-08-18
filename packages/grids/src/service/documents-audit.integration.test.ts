import { beforeAll, describe, expect } from "bun:test";
import { ok } from "@k2b/stdlib";
import { sql } from "bun";
import { postgresTest, testShortId as shortId, testUuid as uuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { logAudit } from "./audit";
import {
  createDocumentRun,
  createRecordSnapshot,
  createRecordSnapshotDraft,
  createRenderedDocumentRun,
  getDocumentRun,
  getRunPdf,
  getTemplate,
  renderWorkflowRunPdf,
  updateRunMetadata,
} from "./documents";
import { provisionDocumentNumberSeries } from "./number-series";
import { ALL_RECORD_ACCESS } from "./record-access";
import { deleteTestWorkflowScope, insertTestWorkflow, insertTestWorkflowRun } from "./workflow-test-fixture";

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
    INSERT INTO grids.records (id, short_id, table_id, data, created_by, updated_by)
    VALUES (
      ${fixture.recordId}::uuid,
      ${shortId("R")},
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
      '{{ template.id }}-{{ run.id }}',
      '{{ document.number }}.pdf',
      ${fixture.actorId}::uuid,
      ${fixture.actorId}::uuid
    )
  `;
  await provisionDocumentNumberSeries(sql, fixture.templateId, "{{ template.id }}-{{ run.id }}");
};

const cleanupFixture = async (fixture: Fixture): Promise<void> => {
  const artifactRows = await sql<Array<{ id: string }>>`
    SELECT artifact_file_id::text AS id
    FROM grids.document_runs
    WHERE base_id = ${fixture.baseId}::uuid AND artifact_file_id IS NOT NULL
  `;
  await sql`DELETE FROM grids.audit_log WHERE base_id = ${fixture.baseId}::uuid`;
  await sql`DELETE FROM grids.document_runs WHERE base_id = ${fixture.baseId}::uuid`;
  await sql`DELETE FROM grids.file_protected_references WHERE base_id = ${fixture.baseId}::uuid`;
  if (artifactRows.length > 0)
    await sql`DELETE FROM grids.files WHERE id = ANY(${sql.array(
      artifactRows.map((row) => row.id),
      "UUID",
    )}::uuid[])`;
  await sql`DELETE FROM grids.record_snapshots WHERE base_id = ${fixture.baseId}::uuid`;
  await deleteTestWorkflowScope(fixture.baseId);
  await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
  await sql`DELETE FROM auth.users WHERE id = ${fixture.actorId}::uuid`;
};

const PDF_ONE = new TextEncoder().encode("%PDF-1.7\nfirst immutable artifact");
const renderPdf = async () => ok({ pdf: PDF_ONE, contentType: "application/pdf" });

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("document audit integration", () => {
  postgresTest("keeps exact artifact bytes and creates a distinct artifact when generated again", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const template = await getTemplate(fixture.templateId);
      if (!template) throw new Error("Fixture template missing");
      const firstSnapshot = await createRecordSnapshotDraft({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        actorId: fixture.actorId,
        resolveRecordAccess: async () => ALL_RECORD_ACCESS,
      });
      if (!firstSnapshot.ok) throw new Error(firstSnapshot.error.message);
      const first = await createRenderedDocumentRun({
        template,
        snapshot: firstSnapshot.data,
        renderData: { record: firstSnapshot.data.root, snapshot: firstSnapshot.data },
        actorId: fixture.actorId,
        persistSnapshot: true,
        renderPdf,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);

      await sql`UPDATE grids.records SET data = ${{ [fixture.fieldId]: "Changed later" }}::jsonb WHERE id = ${fixture.recordId}::uuid`;
      await sql`UPDATE grids.document_templates SET html = '<p>Changed later</p>' WHERE id = ${fixture.templateId}::uuid`;

      const reloaded = await getDocumentRun(first.data.run.id);
      expect(reloaded?.artifact).toEqual(first.data.run.artifact);
      if (!reloaded) throw new Error("Document run missing");
      const downloaded = await getRunPdf(reloaded);
      expect(downloaded.ok).toBe(true);
      if (downloaded.ok) expect(downloaded.data.pdf).toEqual(PDF_ONE);

      const secondSnapshot = await createRecordSnapshotDraft({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        actorId: fixture.actorId,
        resolveRecordAccess: async () => ALL_RECORD_ACCESS,
      });
      if (!secondSnapshot.ok) throw new Error(secondSnapshot.error.message);
      const pdfTwo = new TextEncoder().encode("%PDF-1.7\nsecond immutable artifact");
      const second = await createRenderedDocumentRun({
        template: { ...template, html: "<p>Changed later</p>" },
        snapshot: secondSnapshot.data,
        renderData: { record: secondSnapshot.data.root, snapshot: secondSnapshot.data },
        actorId: fixture.actorId,
        persistSnapshot: true,
        renderPdf: async () => ok({ pdf: pdfTwo, contentType: "application/pdf" }),
      });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);
      expect(second.data.run.id).not.toBe(first.data.run.id);
      expect(second.data.run.artifact).not.toEqual(first.data.run.artifact);
      const firstAgain = await getRunPdf(reloaded);
      expect(firstAgain.ok).toBe(true);
      if (firstAgain.ok) expect(firstAgain.data.pdf).toEqual(PDF_ONE);

      const [{ protected_count: protectedCount, run_count: runCount } = { protected_count: 0, run_count: 0 }] = await sql<
        Array<{ protected_count: number; run_count: number }>
      >`
        SELECT
          (SELECT count(*)::int FROM grids.file_protected_references WHERE base_id = ${fixture.baseId}::uuid AND owner_kind = 'document_artifact') AS protected_count,
          (SELECT count(*)::int FROM grids.document_runs WHERE base_id = ${fixture.baseId}::uuid AND artifact_file_id IS NOT NULL) AS run_count
      `;
      expect({ protectedCount, runCount }).toEqual({ protectedCount: 2, runCount: 2 });

      const corruptedBytes = new Uint8Array(reloaded.artifact.sizeBytes).fill(1);
      await sql`UPDATE grids.files SET bytes = ${corruptedBytes} WHERE id = ${reloaded.artifactFileId}::uuid`;
      const corrupted = await getRunPdf(reloaded);
      expect(corrupted.ok).toBe(false);
      if (!corrupted.ok) expect(corrupted.error.message).toBe("Stored document artifact failed its integrity check.");
    } finally {
      await cleanupFixture(fixture);
    }
  });

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
        resolveRecordAccess: async () => ALL_RECORD_ACCESS,
      });
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) throw new Error(snapshot.error.message);
      expect(Object.keys(snapshot.data.graph).sort()).toEqual(["records", "rootId"]);

      const run = await createDocumentRun({
        template,
        snapshot: snapshot.data,
        renderData: { record: snapshot.data.root, snapshot: snapshot.data },
        actorId: fixture.actorId,
        tags: ["draft"],
        renderPdf,
      });
      expect(run.ok).toBe(true);
      if (!run.ok) throw new Error(run.error.message);
      expect(run.data.artifact).toMatchObject({ mimeType: "application/pdf", sizeBytes: PDF_ONE.byteLength });
      const storedPdf = await getRunPdf(run.data);
      expect(storedPdf.ok).toBe(true);
      if (storedPdf.ok) expect(storedPdf.data.pdf).toEqual(PDF_ONE);

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

  postgresTest("does not persist a document run when its stored PDF cannot render", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const template = await getTemplate(fixture.templateId);
      if (!template) throw new Error("Fixture template missing");
      const snapshot = await createRecordSnapshotDraft({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        actorId: fixture.actorId,
        resolveRecordAccess: async () => ALL_RECORD_ACCESS,
      });
      if (!snapshot.ok) throw new Error(snapshot.error.message);

      const result = await createRenderedDocumentRun({
        template: { ...template, html: "{% if %}" },
        snapshot: snapshot.data,
        renderData: { record: snapshot.data.root, snapshot: snapshot.data },
        actorId: fixture.actorId,
        persistSnapshot: true,
      });

      expect(result.ok).toBe(false);
      const invalidArtifact = await createRenderedDocumentRun({
        template,
        snapshot: snapshot.data,
        renderData: { record: snapshot.data.root, snapshot: snapshot.data },
        actorId: fixture.actorId,
        persistSnapshot: true,
        renderPdf: async () => ok({ pdf: new TextEncoder().encode("not a pdf"), contentType: "text/plain" }),
      });
      expect(invalidArtifact.ok).toBe(false);
      const [{ count } = { count: 0 }] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM grids.document_runs WHERE base_id = ${fixture.baseId}::uuid
      `;
      expect(count).toBe(0);
      const [{ count: snapshotCount } = { count: 0 }] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM grids.record_snapshots WHERE base_id = ${fixture.baseId}::uuid
      `;
      expect(snapshotCount).toBe(0);
      const [{ count: assetCount } = { count: 0 }] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM grids.file_protected_references WHERE base_id = ${fixture.baseId}::uuid
      `;
      expect(assetCount).toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("rolls back the snapshot, artifact, and run when the audit write fails", async () => {
    const fixture = createFixture();
    const suffix = fixture.recordId.replaceAll("-", "");
    const functionName = `reject_document_audit_${suffix}`;
    const triggerName = `reject_document_audit_${suffix}`;
    try {
      await insertFixture(fixture);
      const template = await getTemplate(fixture.templateId);
      if (!template) throw new Error("Fixture template missing");
      const snapshot = await createRecordSnapshotDraft({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        actorId: fixture.actorId,
        resolveRecordAccess: async () => ALL_RECORD_ACCESS,
      });
      if (!snapshot.ok) throw new Error(snapshot.error.message);

      await sql.unsafe(`
        CREATE FUNCTION grids.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.record_id = '${fixture.recordId}'::uuid AND NEW.action = 'document.generated' THEN
            RAISE EXCEPTION 'intentional document audit failure';
          END IF;
          RETURN NEW;
        END
        $$
      `);
      await sql.unsafe(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON grids.audit_log
        FOR EACH ROW EXECUTE FUNCTION grids.${functionName}()
      `);

      await expect(
        createRenderedDocumentRun({
          template,
          snapshot: snapshot.data,
          renderData: { record: snapshot.data.root, snapshot: snapshot.data },
          actorId: fixture.actorId,
          persistSnapshot: true,
          renderPdf,
        }),
      ).rejects.toThrow("intentional document audit failure");
      const [state] = await sql<Array<{ runs: number; snapshots: number; protections: number; assets: number }>>`
        SELECT
          (SELECT count(*)::int FROM grids.document_runs WHERE base_id = ${fixture.baseId}::uuid) AS runs,
          (SELECT count(*)::int FROM grids.record_snapshots WHERE base_id = ${fixture.baseId}::uuid) AS snapshots,
          (SELECT count(*)::int FROM grids.file_protected_references WHERE base_id = ${fixture.baseId}::uuid) AS protections,
          (SELECT count(*)::int FROM grids.files WHERE created_by = ${fixture.actorId}::uuid) AS assets
      `;
      expect(state).toEqual({ runs: 0, snapshots: 0, protections: 0, assets: 0 });
    } finally {
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON grids.audit_log`);
      await sql.unsafe(`DROP FUNCTION IF EXISTS grids.${functionName}()`);
      await cleanupFixture(fixture);
    }
  });

  postgresTest("does not duplicate the workflow runtime generation audit", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const workflowId = uuid();
      const workflowRunId = uuid();
      const workflowPlan = { inputs: {}, automatic: {}, steps: [] };
      await insertTestWorkflow({
        id: workflowId,
        shortId: shortId("W"),
        baseId: fixture.baseId,
        name: "Generate invoice",
        source: "steps: []",
        plan: workflowPlan,
        enabled: true,
        position: 0,
        ownerUserId: fixture.actorId,
      });
      await insertTestWorkflowRun({
        id: workflowRunId,
        workflowId,
        baseId: fixture.baseId,
        state: "running",
        actorUserId: fixture.actorId,
      });

      const template = await getTemplate(fixture.templateId);
      if (!template) throw new Error("Fixture template missing");
      const snapshot = await createRecordSnapshot({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordId,
        actorId: fixture.actorId,
        resolveRecordAccess: async () => ALL_RECORD_ACCESS,
      });
      if (!snapshot.ok) throw new Error(snapshot.error.message);
      const run = await createDocumentRun({
        template,
        snapshot: snapshot.data,
        renderData: { record: snapshot.data.root, snapshot: snapshot.data },
        actorId: fixture.actorId,
        workflowRunId,
        renderPdf,
      });
      expect(run.ok).toBe(true);
      if (!run.ok) throw new Error(run.error.message);

      const combinedPdf = await renderWorkflowRunPdf(workflowRunId, async () => true);
      expect(combinedPdf.ok).toBe(true);
      if (combinedPdf.ok) expect(combinedPdf.data.pdf).toEqual(PDF_ONE);

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
