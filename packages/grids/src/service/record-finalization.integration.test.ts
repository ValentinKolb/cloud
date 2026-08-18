import { beforeAll, describe, expect } from "bun:test";
import { sql } from "bun";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { previewDslQuery } from "../query-dsl/preview";
import { resolveDslQueryToQueryPlan } from "../query-dsl/resolver";
import * as durableHistory from "./durable-history";
import * as fields from "./fields";
import * as files from "./files";
import * as finalization from "./record-finalization";
import * as records from "./record-write";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

const fixture = async () => {
  const baseId = testUuid();
  const tableId = testUuid();
  const tableShortId = testShortId("T");
  await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'Finalization')`;
  await sql`INSERT INTO grids.tables (id, short_id, base_id, name) VALUES (${tableId}::uuid, ${tableShortId}, ${baseId}::uuid, 'Cases')`;
  const name = await fields.create({ tableId, name: "Name", type: "text", presentable: true }, null);
  const attachment = await fields.create({ tableId, name: "Attachment", type: "file" }, null);
  if (!name.ok || !attachment.ok) throw new Error("fixture fields failed");
  const history = await durableHistory.enable(tableId, null);
  if (!history.ok || !history.data.enabled || history.data.status !== "active") throw new Error("history activation failed");
  const enabled = await finalization.enable(tableId, null);
  if (!enabled.ok) throw enabled.error;
  const number = await fields.create(
    {
      tableId,
      name: "Final number",
      type: "id",
      config: { strategy: "sequence", prefix: "FIN-", padding: 3, assignment: "finalization" },
    },
    null,
  );
  if (!number.ok) throw number.error;
  const relation = await fields.create(
    { tableId, name: "Related case", type: "relation", config: { targetTableId: tableId, cardinality: "single" } },
    null,
  );
  if (!relation.ok) throw relation.error;
  return { baseId, tableId, tableShortId, name: name.data, attachment: attachment.data, number: number.data, relation: relation.data };
};

const cleanup = async (baseId: string) => {
  await sql`
    UPDATE grids.records SET finalized_at = NULL, finalized_by = NULL, final_revision_id = NULL
    WHERE table_id IN (SELECT id FROM grids.tables WHERE base_id = ${baseId}::uuid)
  `;
  await sql`DELETE FROM grids.file_protected_references WHERE base_id = ${baseId}::uuid`;
  await sql`DELETE FROM grids.record_revisions WHERE table_id IN (SELECT id FROM grids.tables WHERE base_id = ${baseId}::uuid)`;
  await sql`DELETE FROM grids.table_finalization_activations WHERE table_id IN (SELECT id FROM grids.tables WHERE base_id = ${baseId}::uuid)`;
  await sql`DELETE FROM grids.durable_history_activations WHERE table_id IN (SELECT id FROM grids.tables WHERE base_id = ${baseId}::uuid)`;
  await sql`DELETE FROM grids.table_schema_revisions WHERE table_id IN (SELECT id FROM grids.tables WHERE base_id = ${baseId}::uuid)`;
  await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
};

describe("record finalization Postgres integration", () => {
  postgresTest("keeps tables in draft mode until history-backed finalization is explicitly enabled", async () => {
    const baseId = testUuid();
    const tableId = testUuid();
    await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'Draft default')`;
    await sql`INSERT INTO grids.tables (id, short_id, base_id, name) VALUES (${tableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Drafts')`;
    try {
      expect(await finalization.getStatus(tableId)).toEqual({ ok: true, data: { enabled: false, durableHistory: "disabled" } });
      const withoutHistory = await finalization.enable(tableId, null);
      expect(withoutHistory.ok).toBe(false);
      if (!withoutHistory.ok) expect(withoutHistory.error.status).toBe(400);
      const prematureField = await fields.create(
        {
          tableId,
          name: "Final number",
          type: "id",
          config: { strategy: "sequence", prefix: "FIN-", padding: 3, assignment: "finalization" },
        },
        null,
      );
      expect(prematureField.ok).toBe(false);

      const history = await durableHistory.enable(tableId, null);
      if (!history.ok) throw history.error;
      const enabled = await finalization.enable(tableId, null);
      expect(enabled.ok && enabled.data.enabled).toBe(true);
      expect(await finalization.disable(tableId, null)).toEqual({
        ok: true,
        data: { enabled: false, durableHistory: "active" },
      });
    } finally {
      await cleanup(baseId);
    }
  });

  postgresTest("finalizes once, allocates one final number, and blocks every record mutation owner", async () => {
    const item = await fixture();
    try {
      const incomplete = await records.create(item.tableId, {}, null, "direct");
      if (!incomplete.ok) throw incomplete.error;
      const required = await fields.update(item.name.id, { required: true }, null);
      if (!required.ok) throw required.error;
      const readiness = await finalization.inspect({ tableId: item.tableId, recordId: incomplete.data.id });
      expect(readiness.ok && readiness.data.missing).toEqual([
        { fieldId: item.name.id, fieldName: "Name", message: "A value is required." },
      ]);
      expect((await finalization.finalize({ tableId: item.tableId, recordId: incomplete.data.id, actorId: null, origin: "direct" })).ok).toBe(
        false,
      );

      const target = await records.create(item.tableId, { [item.name.id]: "Target" }, null, "direct");
      if (!target.ok) throw target.error;
      const created = await records.create(
        item.tableId,
        { [item.name.id]: "Ready", [item.relation.id]: [target.data.id] },
        null,
        "direct",
      );
      if (!created.ok) throw created.error;
      expect(created.data.data[item.number.id]).toBeUndefined();
      const attached = await files.upload({
        tableId: item.tableId,
        recordId: created.data.id,
        fieldId: item.attachment.id,
        filename: "evidence.txt",
        mimeType: "text/plain",
        bytes: new TextEncoder().encode("original"),
        userId: null,
        origin: "direct",
      });
      if (!attached.ok) throw attached.error;

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          finalization.finalize({ tableId: item.tableId, recordId: created.data.id, actorId: null, origin: "direct" }),
        ),
      );
      expect(results.every((result) => result.ok)).toBe(true);
      const finalNumbers = results.flatMap((result) => (result.ok ? [result.data.data[item.number.id]] : []));
      expect(new Set(finalNumbers).size).toBe(1);
      expect(finalNumbers[0]).toBe("FIN-001");

      const [state] = await sql<Array<{ finalized_at: Date; final_revision_id: string; allocations: number; revisions: number }>>`
        SELECT record.finalized_at, record.final_revision_id::text,
          (SELECT COUNT(*)::int FROM grids.number_allocations allocation
           JOIN grids.number_series series ON series.id = allocation.series_id
           WHERE series.field_id = ${item.number.id}::uuid AND allocation.consumer_id = record.id) AS allocations,
          (SELECT COUNT(*)::int FROM grids.record_revisions revision
           WHERE revision.id = record.final_revision_id AND revision.action = 'finalized') AS revisions
        FROM grids.records record WHERE record.id = ${created.data.id}::uuid
      `;
      expect(state?.finalized_at).toBeTruthy();
      expect(state?.final_revision_id).toBeTruthy();
      expect(state?.allocations).toBe(1);
      expect(state?.revisions).toBe(1);

      const tableFields = await fields.listByTable(item.tableId);
      const parsed = parseGridsQueryDsl(`from table {${item.tableShortId}}\nselect {${item.name.shortId}}`);
      if (!parsed.ok) throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
      const resolved = resolveDslQueryToQueryPlan(parsed.ast, {
        currentTable: { kind: "table", id: item.tableId, shortId: item.tableShortId, name: "Cases" },
        tables: [{ kind: "table", id: item.tableId, shortId: item.tableShortId, name: "Cases" }],
        views: [],
        fieldsByTableId: { [item.tableId]: tableFields },
      });
      if (!resolved.ok) throw new Error(resolved.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
      const preview = await previewDslQuery(resolved.plan, { fieldsByTableId: { [item.tableId]: tableFields }, limit: 20 });
      if (!preview.ok) throw preview.error;
      expect(preview.data.rows.find((row) => row.recordId === created.data.id)?.recordMeta?.finalizedAt).toBeTruthy();

      const update = await records.update(item.tableId, created.data.id, { [item.name.id]: "Changed" }, null, "direct");
      expect(update.ok).toBe(false);
      if (!update.ok) expect(update.error.status).toBe(409);
      expect((await records.softDelete(item.tableId, created.data.id, null, "direct")).ok).toBe(false);
      const upload = await files.upload({
        tableId: item.tableId,
        recordId: created.data.id,
        fieldId: item.attachment.id,
        filename: "late.txt",
        mimeType: "text/plain",
        bytes: new TextEncoder().encode("late"),
        userId: null,
        origin: "direct",
      });
      expect(upload.ok).toBe(false);
      if (!upload.ok) expect(upload.error.status).toBe(409);
      const replaced = await files.replace({
        tableId: item.tableId,
        recordId: created.data.id,
        fieldId: item.attachment.id,
        fileId: attached.data.id,
        filename: "replacement.txt",
        mimeType: "text/plain",
        bytes: new TextEncoder().encode("replacement"),
        userId: null,
        origin: "direct",
      });
      expect(replaced.ok).toBe(false);
      if (!replaced.ok) expect(replaced.error.status).toBe(409);
      const removed = await files.remove({
        tableId: item.tableId,
        recordId: created.data.id,
        fieldId: item.attachment.id,
        fileId: attached.data.id,
        userId: null,
        origin: "direct",
      });
      expect(removed.ok).toBe(false);
      if (!removed.ok) expect(removed.error.status).toBe(409);
      const disabled = await finalization.disable(item.tableId, null);
      expect(disabled.ok).toBe(false);
      if (!disabled.ok) expect(disabled.error.status).toBe(409);
    } finally {
      await cleanup(item.baseId);
    }
  });

  postgresTest("refuses finalization when a linked record is no longer live", async () => {
    const item = await fixture();
    try {
      const target = await records.create(item.tableId, { [item.name.id]: "Temporary target" }, null, "direct");
      if (!target.ok) throw target.error;
      const source = await records.create(
        item.tableId,
        { [item.name.id]: "Source", [item.relation.id]: [target.data.id] },
        null,
        "direct",
      );
      if (!source.ok) throw source.error;
      const removed = await records.softDelete(item.tableId, target.data.id, null, "direct");
      if (!removed.ok) throw removed.error;

      const readiness = await finalization.inspect({ tableId: item.tableId, recordId: source.data.id });
      expect(readiness.ok && readiness.data.missing).toContainEqual({
        fieldId: item.relation.id,
        fieldName: "Related case",
        message: "A linked record is no longer available.",
      });
      const finalized = await finalization.finalize({ tableId: item.tableId, recordId: source.data.id, actorId: null, origin: "direct" });
      expect(finalized.ok).toBe(false);
      if (!finalized.ok) expect(finalized.error.status).toBe(400);
    } finally {
      await cleanup(item.baseId);
    }
  });

  postgresTest("rolls back the marker, revision, and allocation while preserving the intentional number gap", async () => {
    const item = await fixture();
    const triggerName = `fail_final_${item.tableId.replaceAll("-", "")}`;
    const functionName = `${triggerName}_fn`;
    try {
      const primer = await records.create(item.tableId, { [item.name.id]: "Primer" }, null, "direct");
      if (!primer.ok) throw primer.error;
      const primed = await finalization.finalize({ tableId: item.tableId, recordId: primer.data.id, actorId: null, origin: "direct" });
      if (!primed.ok) throw primed.error;
      expect(primed.data.data[item.number.id]).toBe("FIN-001");
      const draft = await records.create(item.tableId, { [item.name.id]: "Rollback" }, null, "direct");
      if (!draft.ok) throw draft.error;
      await sql.unsafe(`
        CREATE FUNCTION grids.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'finalized' THEN RAISE EXCEPTION 'forced final revision failure'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER ${triggerName} BEFORE INSERT ON grids.record_revisions
        FOR EACH ROW EXECUTE FUNCTION grids.${functionName}();
      `);
      await expect(
        finalization.finalize({ tableId: item.tableId, recordId: draft.data.id, actorId: null, origin: "direct" }),
      ).rejects.toThrow(
        "forced final revision failure",
      );
      const [rolledBack] = await sql<Array<{ finalized_at: Date | null; value: string | null; allocations: number }>>`
        SELECT finalized_at, data->>${item.number.id} AS value,
          (SELECT COUNT(*)::int FROM grids.number_allocations allocation
           JOIN grids.number_series series ON series.id = allocation.series_id WHERE series.field_id = ${item.number.id}::uuid) AS allocations
        FROM grids.records WHERE id = ${draft.data.id}::uuid
      `;
      expect(rolledBack).toEqual({ finalized_at: null, value: null, allocations: 1 });
      await sql.unsafe(`DROP TRIGGER ${triggerName} ON grids.record_revisions; DROP FUNCTION grids.${functionName}()`);
      const finalized = await finalization.finalize({ tableId: item.tableId, recordId: draft.data.id, actorId: null, origin: "direct" });
      if (!finalized.ok) throw finalized.error;
      expect(finalized.data.data[item.number.id]).toBe("FIN-003");
    } finally {
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON grids.record_revisions`).catch(() => undefined);
      await sql.unsafe(`DROP FUNCTION IF EXISTS grids.${functionName}()`).catch(() => undefined);
      await cleanup(item.baseId);
    }
  });
});
