import { type DateContext, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { RecordSnapshot, RecordSnapshotSummary } from "../contracts";
import { logAudit } from "./audit";
import { type DocumentDbRow, mapRecordSnapshot, mapRecordSnapshotSummary } from "./document-mappers";
import { listByTable as listFields } from "./fields";
import { get as getRecord } from "./records";
import { get as getTable } from "./tables";
import type { Field, GridRecord, Table } from "./types";

const SNAPSHOT_MAX_DEPTH = 4;
const SNAPSHOT_MAX_RECORDS = 500;

export type SnapshotRecord = {
  id: string;
  table: Pick<Table, "id" | "shortId" | "name">;
  fields: Array<
    Pick<
      Field,
      | "id"
      | "shortId"
      | "name"
      | "description"
      | "icon"
      | "type"
      | "config"
      | "position"
      | "required"
      | "presentable"
      | "hideInTable"
      | "defaultValue"
      | "indexed"
      | "uniqueConstraint"
      | "deletedAt"
      | "createdAt"
      | "updatedAt"
    >
  >;
  data: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const relationIds = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
};

const snapshotRecord = (table: Table, fields: Field[], record: GridRecord): SnapshotRecord => ({
  id: record.id,
  table: { id: table.id, shortId: table.shortId, name: table.name },
  fields: fields.map((field) => ({
    id: field.id,
    shortId: field.shortId,
    name: field.name,
    description: field.description,
    icon: field.icon,
    type: field.type,
    config: field.config,
    position: field.position,
    required: field.required,
    presentable: field.presentable,
    hideInTable: field.hideInTable,
    defaultValue: field.defaultValue,
    indexed: field.indexed,
    uniqueConstraint: field.uniqueConstraint,
    deletedAt: field.deletedAt,
    createdAt: field.createdAt,
    updatedAt: field.updatedAt,
  })),
  data: record.data,
  version: record.version,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  deletedAt: record.deletedAt,
});

const buildRecordSnapshotGraph = async (
  tableId: string,
  recordId: string,
  options: { dateConfig?: DateContext; maxDepth?: number; maxRecords?: number } = {},
): Promise<Result<{ root: SnapshotRecord; graph: { rootId: string; records: Record<string, SnapshotRecord> } }>> => {
  const maxDepth = options.maxDepth ?? SNAPSHOT_MAX_DEPTH;
  const maxRecords = options.maxRecords ?? SNAPSHOT_MAX_RECORDS;
  const records: Record<string, SnapshotRecord> = {};
  const seen = new Set<string>();

  const visit = async (currentTableId: string, currentRecordId: string, depth: number): Promise<Result<SnapshotRecord>> => {
    if (seen.size >= maxRecords) return fail(err.badInput(`snapshot exceeds ${maxRecords} records`));
    const key = `${currentTableId}:${currentRecordId}`;
    const existing = records[key];
    if (existing) return ok(existing);
    seen.add(key);

    const table = await getTable(currentTableId);
    if (!table) return fail(err.notFound("Table"));
    const fields = await listFields(currentTableId);
    const record = await getRecord(currentTableId, currentRecordId, { dateConfig: options.dateConfig });
    if (!record) return fail(err.notFound("Record"));
    const captured = snapshotRecord(table, fields, record);
    records[key] = captured;

    if (depth < maxDepth) {
      for (const field of fields) {
        if (field.type !== "relation") continue;
        const targetTableId = typeof field.config.targetTableId === "string" ? field.config.targetTableId : null;
        if (!targetTableId) continue;
        for (const targetRecordId of relationIds(record.data[field.id])) {
          const nested = await visit(targetTableId, targetRecordId, depth + 1);
          if (!nested.ok) return nested;
        }
      }
    }
    return ok(captured);
  };

  const root = await visit(tableId, recordId, 0);
  if (!root.ok) return root;
  return ok({ root: root.data, graph: { rootId: `${tableId}:${recordId}`, records } });
};

export const createRecordSnapshot = async (params: {
  baseId: string;
  tableId: string;
  recordId: string;
  actorId: string | null;
  dateConfig?: DateContext;
}): Promise<Result<RecordSnapshot>> => {
  const graph = await buildRecordSnapshotGraph(params.tableId, params.recordId, { dateConfig: params.dateConfig });
  if (!graph.ok) return graph;

  return sql.begin(async (tx) => {
    const [row] = await tx<DocumentDbRow[]>`
      INSERT INTO grids.record_snapshots (base_id, table_id, record_id, root, graph, created_by)
      VALUES (${params.baseId}::uuid, ${params.tableId}::uuid, ${params.recordId}::uuid, ${graph.data.root}::jsonb, ${graph.data.graph}::jsonb, ${params.actorId}::uuid)
      RETURNING *
    `;
    if (!row) return fail(err.internal("Could not create record snapshot"));
    const snapshot = mapRecordSnapshot(row);
    await logAudit(
      {
        baseId: params.baseId,
        tableId: params.tableId,
        recordId: params.recordId,
        userId: params.actorId,
        action: "record_snapshot.created",
        diff: {
          snapshotId: { old: null, new: snapshot.id },
          recordVersion: { old: null, new: graph.data.root.version },
        },
      },
      tx,
    );
    return ok(snapshot);
  });
};

export const getSnapshot = async (snapshotId: string): Promise<RecordSnapshot | null> => {
  const [row] = await sql<DocumentDbRow[]>`SELECT * FROM grids.record_snapshots WHERE id = ${snapshotId}::uuid`;
  return row ? mapRecordSnapshot(row) : null;
};

export const listSnapshotsForRecord = async (tableId: string, recordId: string): Promise<RecordSnapshotSummary[]> => {
  const rows = await sql<DocumentDbRow[]>`
    SELECT snapshot.id, snapshot.base_id, snapshot.table_id, snapshot.record_id, snapshot.created_by, snapshot.created_at
    FROM grids.record_snapshots snapshot
    WHERE snapshot.table_id = ${tableId}::uuid
      AND snapshot.record_id = ${recordId}::uuid
      AND NOT EXISTS (
        SELECT 1
        FROM grids.document_runs run
        WHERE run.snapshot_id = snapshot.id
      )
    ORDER BY snapshot.created_at DESC
  `;
  return rows.map(mapRecordSnapshotSummary);
};
