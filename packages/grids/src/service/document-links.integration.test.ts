import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import {
  createDocumentLink,
  getDocumentRun,
  listDocumentLinksForRun,
  recordDocumentLinkAccess,
  resolveDocumentLinkDownload,
  revokeDocumentLink,
} from "./documents";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type DocumentLinkFixture = {
  baseId: string;
  tableId: string;
  recordId: string;
  snapshotId: string;
  runId: string;
};

const insertFixture = async (): Promise<DocumentLinkFixture> => {
  const baseId = uuid();
  const tableId = uuid();
  const recordId = uuid();
  const snapshotId = uuid();
  const runId = uuid();
  const documentNumber = `INV-${runId.slice(0, 8)}`;

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'Document link integration')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Invoices', 0)
  `;
  await sql`
    INSERT INTO grids.record_snapshots (id, base_id, table_id, record_id, root, graph)
    VALUES (
      ${snapshotId}::uuid,
      ${baseId}::uuid,
      ${tableId}::uuid,
      ${recordId}::uuid,
      ${{ id: recordId, tableId, data: { Name: "Invoice 1" } }}::jsonb,
      ${{ rootId: `${tableId}:${recordId}`, records: {} }}::jsonb
    )
  `;
  await sql`
    INSERT INTO grids.document_runs (
      id, short_id, template_id, snapshot_id, base_id, table_id, record_id,
      document_number, filename, tags, template_snapshot, render_data
    )
    VALUES (
      ${runId}::uuid,
      ${shortId("D")},
      NULL,
      ${snapshotId}::uuid,
      ${baseId}::uuid,
      ${tableId}::uuid,
      ${recordId}::uuid,
      ${documentNumber},
      'invoice-1.pdf',
      '{}'::text[],
      ${{ html: "<p>{{ document.number }}</p>", headerHtml: null, footerHtml: null, pageCss: null }}::jsonb,
      ${{ document: { number: documentNumber, generatedAt: "2026-07-07T00:00:00.000Z" } }}::jsonb
    )
  `;

  return { baseId, tableId, recordId, snapshotId, runId };
};

const cleanupFixture = async (fixture: DocumentLinkFixture): Promise<void> => {
  await sql`DELETE FROM grids.document_links WHERE document_run_id = ${fixture.runId}::uuid`;
  await sql`DELETE FROM grids.document_runs WHERE id = ${fixture.runId}::uuid`;
  await sql`DELETE FROM grids.record_snapshots WHERE id = ${fixture.snapshotId}::uuid`;
  await sql`DELETE FROM grids.tables WHERE id = ${fixture.tableId}::uuid`;
  await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("document links integration", () => {
  postgresTest("creates hashed expiring links and rejects revoked links", async () => {
    const fixture = await insertFixture();
    try {
      const run = await getDocumentRun(fixture.runId);
      if (!run) throw new Error("Fixture run missing");

      const created = await createDocumentLink({
        run,
        input: { expiresIn: "30d", comment: "Customer copy" },
        actorId: null,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error.message);
      expect(created.data.token.startsWith("gdl_")).toBe(true);
      expect(created.data.link.comment).toBe("Customer copy");
      expect(new Date(created.data.link.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const [stored] = await sql<Array<{ token_hash: string }>>`
        SELECT token_hash
        FROM grids.document_links
        WHERE id = ${created.data.link.id}::uuid
      `;
      expect(stored?.token_hash).toBeTruthy();
      expect(stored?.token_hash).not.toBe(created.data.token);

      const listed = await listDocumentLinksForRun(run.id);
      expect(listed.map((link) => link.id)).toContain(created.data.link.id);

      const resolved = await resolveDocumentLinkDownload(created.data.token);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.data.run.id).toBe(run.id);
        expect(resolved.data.link.accessCount).toBe(0);
      }

      const accessed = await recordDocumentLinkAccess(created.data.link.id);
      expect(accessed.ok).toBe(true);
      if (accessed.ok) {
        expect(accessed.data.accessCount).toBe(1);
        expect(accessed.data.lastAccessedAt).toBeTruthy();
      }

      const revoked = await revokeDocumentLink({ linkId: created.data.link.id, actorId: null });
      expect(revoked.ok).toBe(true);
      if (revoked.ok) expect(revoked.data.revokedAt).toBeTruthy();

      const afterRevoke = await resolveDocumentLinkDownload(created.data.token);
      expect(afterRevoke.ok).toBe(false);
      const accessAfterRevoke = await recordDocumentLinkAccess(created.data.link.id);
      expect(accessAfterRevoke.ok).toBe(false);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
