import { beforeAll, describe, expect } from "bun:test";
import { sql } from "bun";
import { migrate as migrateCoreWorkflows } from "../../../core/src/migrate/core/workflows";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import * as fields from "./fields";
import { cleanup, getProtectedContent, listForRecordField, protect, releaseProtection, remove, replace, upload } from "./files";
import * as records from "./record-write";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST !== "1") return;
  await migrateCoreWorkflows();
  await migrate();
});

const createFixture = async () => {
  const baseId = testUuid();
  const tableId = testUuid();
  await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'File lifecycle')`;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name)
    VALUES (${tableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Records')
  `;
  const field = await fields.create({ tableId, name: "Attachments", type: "file", config: { maxFiles: 3 } }, null);
  if (!field.ok) throw field.error;
  const record = await records.create(tableId, {}, null);
  if (!record.ok) throw record.error;
  return { baseId, tableId, fieldId: field.data.id, recordId: record.data.id };
};

const destroyFixture = async (baseId: string) => {
  await sql`DELETE FROM grids.file_protected_references WHERE base_id = ${baseId}::uuid`;
  await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
  await sql`
    DELETE FROM grids.files file
    WHERE NOT EXISTS (SELECT 1 FROM grids.file_attachments attachment WHERE attachment.file_id = file.id)
      AND NOT EXISTS (SELECT 1 FROM grids.file_protected_references protected WHERE protected.file_id = file.id)
  `;
};

const bytes = (value: string) => new TextEncoder().encode(value);

describe("durable file asset lifecycle Postgres integration", () => {
  postgresTest("keeps protected exact bytes after detach and cleans them after the last protection is released", async () => {
    const fixture = await createFixture();
    const ownerId = testUuid();
    try {
      const added = await upload({
        ...fixture,
        filename: "evidence.txt",
        mimeType: "text/plain",
        bytes: bytes("exact evidence"),
        userId: null,
      });
      expect(added.ok).toBe(true);
      if (!added.ok) throw added.error;

      expect(
        (
          await protect({
            fileId: added.data.id,
            ownerKind: "record_revision",
            ownerId,
            ...fixture,
            userId: null,
          })
        ).ok,
      ).toBe(true);
      expect((await remove({ ...fixture, fileId: added.data.id, userId: null })).ok).toBe(true);
      await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;

      const retained = await getProtectedContent({ fileId: added.data.id, ownerKind: "record_revision", ownerId });
      expect(retained.ok).toBe(true);
      if (!retained.ok) throw retained.error;
      expect(retained.data.shortId).toBe(added.data.shortId);
      expect(retained.data.sha256).toBe(added.data.sha256);
      expect(retained.data.bytes).toEqual(bytes("exact evidence"));

      const [audit] = await sql<Array<{ actions: string[]; diff: Record<string, unknown>[] }>>`
        SELECT array_agg(action ORDER BY created_at) AS actions, array_agg(diff ORDER BY created_at) AS diff
        FROM grids.audit_log
        WHERE record_id = ${fixture.recordId}::uuid AND action LIKE 'file.%'
      `;
      expect(audit?.actions).toEqual(["file.added", "file.removed"]);
      expect(audit?.diff.every((entry) => Object.hasOwn(entry, fixture.fieldId))).toBe(true);

      expect((await releaseProtection({ fileId: added.data.id, ownerKind: "record_revision", ownerId })).ok).toBe(true);
      expect((await getProtectedContent({ fileId: added.data.id, ownerKind: "record_revision", ownerId })).ok).toBe(false);
      const [asset] = await sql<Array<{ exists: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM grids.files WHERE id = ${added.data.id}::uuid) AS exists
      `;
      expect(asset?.exists).toBe(false);
    } finally {
      await destroyFixture(fixture.baseId);
    }
  });

  postgresTest("replaces the current attachment atomically without destroying a protected previous asset", async () => {
    const fixture = await createFixture();
    const artifactId = testUuid();
    try {
      const original = await upload({
        ...fixture,
        filename: "original.txt",
        mimeType: "text/plain",
        bytes: bytes("original"),
        userId: null,
      });
      if (!original.ok) throw original.error;
      const protectedResult = await protect({
        fileId: original.data.id,
        ownerKind: "document_artifact",
        ownerId: artifactId,
        ...fixture,
        userId: null,
      });
      if (!protectedResult.ok) throw protectedResult.error;

      const replaced = await replace({
        ...fixture,
        fileId: original.data.id,
        filename: "corrected.txt",
        mimeType: "text/plain",
        bytes: bytes("corrected"),
        userId: null,
      });
      expect(replaced.ok).toBe(true);
      if (!replaced.ok) throw replaced.error;
      expect(replaced.data.id).not.toBe(original.data.id);
      expect(replaced.data.position).toBe(original.data.position);

      const [attachment] = await sql<Array<{ file_id: string }>>`
        SELECT file_id::text FROM grids.file_attachments
        WHERE record_id = ${fixture.recordId}::uuid AND field_id = ${fixture.fieldId}::uuid
      `;
      expect(attachment?.file_id).toBe(replaced.data.id);
      const previous = await getProtectedContent({
        fileId: original.data.id,
        ownerKind: "document_artifact",
        ownerId: artifactId,
      });
      expect(previous.ok).toBe(true);
      if (previous.ok) expect(previous.data.bytes).toEqual(bytes("original"));

      expect((await remove({ ...fixture, fileId: replaced.data.id, userId: null })).ok).toBe(true);
      const cleaned = await cleanup(replaced.data.id);
      expect(cleaned.ok).toBe(true);
      if (cleaned.ok) expect(cleaned.data).toBe(false);
      const [actions] = await sql<Array<{ actions: string[] }>>`
        SELECT array_agg(action ORDER BY created_at) AS actions
        FROM grids.audit_log
        WHERE record_id = ${fixture.recordId}::uuid AND action LIKE 'file.%'
      `;
      expect(actions?.actions).toEqual(["file.added", "file.replaced", "file.removed"]);
    } finally {
      await destroyFixture(fixture.baseId);
    }
  });

  postgresTest("restores the same current attachment after a record trash cycle", async () => {
    const fixture = await createFixture();
    try {
      const added = await upload({
        ...fixture,
        filename: "current.txt",
        mimeType: "text/plain",
        bytes: bytes("current"),
        userId: null,
      });
      if (!added.ok) throw added.error;
      expect((await records.softDelete(fixture.tableId, fixture.recordId, null)).ok).toBe(true);
      expect((await listForRecordField(fixture)).ok).toBe(false);
      expect((await records.restore(fixture.tableId, fixture.recordId, null)).ok).toBe(true);
      const restored = await listForRecordField(fixture);
      expect(restored.ok).toBe(true);
      if (restored.ok) expect(restored.data.map((file) => file.id)).toEqual([added.data.id]);
    } finally {
      await destroyFixture(fixture.baseId);
    }
  });

  postgresTest("rolls back the asset and attachment when the required audit write fails", async () => {
    const fixture = await createFixture();
    const suffix = fixture.recordId.replaceAll("-", "");
    const functionName = `reject_file_audit_${suffix}`;
    const triggerName = `reject_file_audit_${suffix}`;
    try {
      await sql.unsafe(`
        CREATE FUNCTION grids.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.record_id = '${fixture.recordId}'::uuid AND NEW.action = 'file.added' THEN
            RAISE EXCEPTION 'intentional file audit failure';
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
        upload({
          ...fixture,
          filename: "must-rollback.txt",
          mimeType: "text/plain",
          bytes: bytes("must rollback"),
          userId: null,
        }),
      ).rejects.toThrow("intentional file audit failure");
      const [state] = await sql<Array<{ assets: number; attachments: number }>>`
        SELECT
          (SELECT count(*)::int FROM grids.files WHERE filename = 'must-rollback.txt') AS assets,
          (SELECT count(*)::int FROM grids.file_attachments WHERE record_id = ${fixture.recordId}::uuid) AS attachments
      `;
      expect(state).toEqual({ assets: 0, attachments: 0 });
    } finally {
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON grids.audit_log`);
      await sql.unsafe(`DROP FUNCTION IF EXISTS grids.${functionName}()`);
      await destroyFixture(fixture.baseId);
    }
  });

  postgresTest("serializes protection against detach and never deletes a successfully protected asset", async () => {
    const fixture = await createFixture();
    try {
      for (let index = 0; index < 8; index += 1) {
        const added = await upload({
          ...fixture,
          filename: `race-${index}.txt`,
          mimeType: "text/plain",
          bytes: bytes(`race-${index}`),
          userId: null,
        });
        if (!added.ok) throw added.error;
        const ownerId = testUuid();
        const [protectedResult, detached] = await Promise.all([
          protect({
            fileId: added.data.id,
            ownerKind: "record_revision",
            ownerId,
            ...fixture,
            userId: null,
          }),
          remove({ ...fixture, fileId: added.data.id, userId: null }),
        ]);
        expect(detached.ok).toBe(true);
        if (protectedResult.ok) {
          const content = await getProtectedContent({ fileId: added.data.id, ownerKind: "record_revision", ownerId });
          expect(content.ok).toBe(true);
          if (content.ok) expect(content.data.bytes).toEqual(bytes(`race-${index}`));
          await releaseProtection({ fileId: added.data.id, ownerKind: "record_revision", ownerId });
        } else {
          expect(protectedResult.error.status).toBe(404);
        }
      }
    } finally {
      await destroyFixture(fixture.baseId);
    }
  });
});
