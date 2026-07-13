import { type DateContext, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { RecordSnapshot, RecordSnapshotSummary } from "../contracts";
import { logAudit } from "./audit";
import { type DocumentDbRow, mapRecordSnapshot, mapRecordSnapshotSummary } from "./document-mappers";
import { createReader, type RecordReader } from "./record-read";
import { get as getTable } from "./tables";
import type { Field, GridRecord, Table } from "./types";

const SNAPSHOT_MAX_DEPTH = 4;
const SNAPSHOT_MAX_RECORDS = 500;

type SnapshotRelatedTableTarget = {
  baseId: string;
  tableId: string;
};

export type SnapshotRelatedTableGuard = (target: SnapshotRelatedTableTarget) => Promise<boolean>;

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
  options: {
    baseId: string;
    canReadRelatedTable: SnapshotRelatedTableGuard;
    dateConfig?: DateContext;
    maxDepth?: number;
    maxRecords?: number;
  },
): Promise<Result<{ root: SnapshotRecord; graph: { rootId: string; records: Record<string, SnapshotRecord> } }>> => {
  const maxDepth = options.maxDepth ?? SNAPSHOT_MAX_DEPTH;
  const maxRecords = options.maxRecords ?? SNAPSHOT_MAX_RECORDS;
  const records: Record<string, SnapshotRecord> = {};
  const seen = new Set<string>();
  const tables = new Map<string, Table>();
  const readers = new Map<string, RecordReader>();
  const readableRelatedTables = new Map<string, boolean>();

  const loadTable = async (tableId: string): Promise<Table | null> => {
    const cached = tables.get(tableId);
    if (cached) return cached;
    const table = await getTable(tableId);
    if (table) tables.set(tableId, table);
    return table;
  };

  const loadReader = async (tableId: string): Promise<RecordReader> => {
    const cached = readers.get(tableId);
    if (cached) return cached;
    const reader = await createReader(tableId, { dateConfig: options.dateConfig });
    readers.set(tableId, reader);
    return reader;
  };

  const canReadRelatedTable = async (table: Table): Promise<boolean> => {
    const cached = readableRelatedTables.get(table.id);
    if (cached !== undefined) return cached;
    const readable = await options.canReadRelatedTable({ baseId: table.baseId, tableId: table.id });
    readableRelatedTables.set(table.id, readable);
    return readable;
  };

  let frontier = [{ tableId, recordId }];
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const pendingByTable = new Map<string, Set<string>>();
    for (const item of frontier) {
      const key = `${item.tableId}:${item.recordId}`;
      if (seen.has(key)) continue;
      const pending = pendingByTable.get(item.tableId) ?? new Set<string>();
      pending.add(item.recordId);
      pendingByTable.set(item.tableId, pending);
    }

    const capturedAtDepth: Array<{ record: GridRecord; reader: RecordReader }> = [];
    for (const [currentTableId, recordIds] of pendingByTable) {
      const table = await loadTable(currentTableId);
      if (!table) return fail(err.notFound("Table"));
      if (depth === 0 && table.baseId !== options.baseId) return fail(err.badInput("record does not belong to base"));
      if (depth > 0 && !(await canReadRelatedTable(table))) continue;
      if (seen.size + recordIds.size > maxRecords) return fail(err.badInput(`snapshot exceeds ${maxRecords} records`));

      const ids = [...recordIds];
      for (const id of ids) seen.add(`${currentTableId}:${id}`);
      const reader = await loadReader(currentTableId);
      const loaded = await reader.getMany(ids);
      const loadedById = new Map(loaded.map((record) => [record.id, record]));
      for (const id of ids) {
        const record = loadedById.get(id);
        if (!record) return fail(err.notFound("Record"));
        records[`${currentTableId}:${id}`] = snapshotRecord(table, reader.fields, record);
        capturedAtDepth.push({ record, reader });
      }
    }

    if (depth === maxDepth) break;
    const next: typeof frontier = [];
    for (const { record, reader } of capturedAtDepth) {
      for (const field of reader.fields) {
        if (field.type !== "relation") continue;
        const targetTableId = typeof field.config.targetTableId === "string" ? field.config.targetTableId : null;
        if (!targetTableId) continue;
        for (const targetRecordId of relationIds(record.data[field.id])) next.push({ tableId: targetTableId, recordId: targetRecordId });
      }
    }
    frontier = next;
  }

  const rootId = `${tableId}:${recordId}`;
  const root = records[rootId];
  if (!root) return fail(err.internal("Snapshot root was not captured"));
  return ok({ root, graph: { rootId, records } });
};

export const createRecordSnapshot = async (params: {
  baseId: string;
  tableId: string;
  recordId: string;
  actorId: string | null;
  canReadRelatedTable: SnapshotRelatedTableGuard;
  dateConfig?: DateContext;
}): Promise<Result<RecordSnapshot>> => {
  const graph = await buildRecordSnapshotGraph(params.tableId, params.recordId, {
    baseId: params.baseId,
    canReadRelatedTable: params.canReadRelatedTable,
    dateConfig: params.dateConfig,
  });
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

const snapshotGraphParts = (
  snapshot: RecordSnapshot,
): { rootId: string; records: Record<string, unknown>; source: Record<string, unknown> } => {
  const source =
    snapshot.graph && typeof snapshot.graph === "object" && !Array.isArray(snapshot.graph)
      ? (snapshot.graph as Record<string, unknown>)
      : {};
  const rootId = `${snapshot.tableId}:${snapshot.recordId}`;
  const records =
    source.records && typeof source.records === "object" && !Array.isArray(source.records)
      ? (source.records as Record<string, unknown>)
      : {};
  return { rootId, records, source };
};

export const filterSnapshotRelatedRecords = async (
  snapshot: RecordSnapshot,
  canReadRelatedTable: SnapshotRelatedTableGuard,
): Promise<RecordSnapshot> => {
  const { rootId, records, source } = snapshotGraphParts(snapshot);
  const filteredRecords: Record<string, unknown> = { [rootId]: snapshot.root };
  const readableTables = new Map<string, boolean>();

  for (const [key, value] of Object.entries(records)) {
    if (key === rootId || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const tableValue = (value as { table?: unknown }).table;
    if (!tableValue || typeof tableValue !== "object" || Array.isArray(tableValue)) continue;
    const tableId = (tableValue as { id?: unknown }).id;
    if (typeof tableId !== "string") continue;

    let readable = readableTables.get(tableId);
    if (readable === undefined) {
      const table = await getTable(tableId);
      readable = Boolean(table && (await canReadRelatedTable({ baseId: table.baseId, tableId: table.id })));
      readableTables.set(tableId, readable);
    }
    if (readable) filteredRecords[key] = value;
  }

  return { ...snapshot, graph: { ...source, rootId, records: filteredRecords } };
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
