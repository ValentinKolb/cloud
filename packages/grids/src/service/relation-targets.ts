import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { assertFederatedPublication, buildDslSqlRecordSource } from "../query-dsl/sql-record-source";
import { mapFieldRow } from "./field-read";
import { parseJsonbRow } from "./jsonb";
import { liveRecordParentJoinSql } from "./parent-checks";
import { type AuthorizedRecordAccess, recordAccessPredicate } from "./record-access";
import { readRecordLinksBatch } from "./relation-links";
import { get as getTable } from "./tables";
import type { Field, GridRecord } from "./types";

const LABEL_TEXT_TYPES = new Set(["text"]);

type RelationTargets = {
  fields: Field[];
  records: Array<{ id: string; data: Record<string, unknown> }>;
};

export const relationLabelFields = (fields: Field[]): Field[] => {
  const alive = fields.filter((field) => !field.deletedAt).sort((left, right) => left.position - right.position);
  const presentable = alive.filter((field) => field.presentable);
  if (presentable.length > 0) return presentable;
  const firstText = alive.find((field) => LABEL_TEXT_TYPES.has(field.type));
  return firstText ? [firstText] : [];
};

export const selectRelationLabelFields = (fields: Field[], pinnedFieldIds?: readonly string[]): Field[] => {
  if (!pinnedFieldIds) return relationLabelFields(fields);
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  return pinnedFieldIds.flatMap((fieldId) => {
    const field = fieldsById.get(fieldId);
    return field ? [field] : [];
  });
};

export const collectRelationTargetIds = async (records: GridRecord[], fields: Field[]): Promise<Map<string, Set<string>>> => {
  const relationFields = fields.filter((field) => field.type === "relation" && !field.deletedAt);
  if (relationFields.length === 0 || records.length === 0) return new Map();
  const table = await getTable(records[0]!.tableId);
  const links =
    table?.kind === "federated"
      ? null
      : await readRecordLinksBatch(
          records.map((record) => record.id),
          relationFields.map((field) => field.id),
        );
  const idsByTargetTable = new Map<string, Set<string>>();
  for (const field of relationFields) {
    const targetTableId = (field.config as { targetTableId?: string }).targetTableId;
    if (!targetTableId) continue;
    const ids = idsByTargetTable.get(targetTableId) ?? new Set<string>();
    for (const record of records) {
      const value = links?.get(record.id)?.get(field.id) ?? record.data[field.id];
      const recordIds = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      for (const id of recordIds) if (typeof id === "string") ids.add(id);
    }
    idsByTargetTable.set(targetTableId, ids);
  }
  return idsByTargetTable;
};

export const collectHydratedRelationTargetIds = (records: GridRecord[], fields: Field[]): Map<string, Set<string>> => {
  const idsByTargetTable = new Map<string, Set<string>>();
  for (const field of fields) {
    if (field.type !== "relation" || field.deletedAt) continue;
    const targetTableId = (field.config as { targetTableId?: string }).targetTableId;
    if (!targetTableId) continue;
    const ids = idsByTargetTable.get(targetTableId) ?? new Set<string>();
    for (const record of records) {
      const value = record.data[field.id];
      const recordIds = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      for (const id of recordIds) if (typeof id === "string") ids.add(id);
    }
    idsByTargetTable.set(targetTableId, ids);
  }
  return idsByTargetTable;
};

export const loadRelationTargetsBatch = async (
  idsByTargetTable: ReadonlyMap<string, Set<string>>,
  recordAccessByTableId?: ReadonlyMap<string, AuthorizedRecordAccess>,
  labelFieldIdsByTableId?: ReadonlyMap<string, readonly string[]>,
): Promise<Map<string, RelationTargets>> => {
  const targetTableIds = [...idsByTargetTable.keys()];
  if (targetTableIds.length === 0) return new Map();

  const fieldRows = await sql<Array<Record<string, unknown> & { table_kind: string }>>`
    SELECT f.*, t.kind AS table_kind
    FROM grids.fields f
    JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE f.table_id = ANY(${toPgUuidArray(targetTableIds)}::uuid[])
      AND f.deleted_at IS NULL
    ORDER BY f.table_id, f.position, f.created_at
  `;
  const fieldsByTable = new Map<string, Field[]>();
  const tableKinds = new Map<string, string>();
  for (const row of fieldRows) {
    const field = mapFieldRow(row);
    const tableFields = fieldsByTable.get(field.tableId) ?? [];
    tableFields.push(field);
    fieldsByTable.set(field.tableId, tableFields);
    tableKinds.set(field.tableId, row.table_kind);
  }
  const targetsByTable = new Map<string, RelationTargets>();
  const storedTableIds: string[] = [];
  const storedRecordIds = new Set<string>();
  const federatedTableIds: string[] = [];

  for (const targetTableId of targetTableIds) {
    const allFields = fieldsByTable.get(targetTableId) ?? [];
    const fields = selectRelationLabelFields(allFields, labelFieldIdsByTableId?.get(targetTableId));
    targetsByTable.set(targetTableId, { fields, records: [] });
    const ids = idsByTargetTable.get(targetTableId);
    if (!ids || ids.size === 0 || fields.length === 0 || (recordAccessByTableId && !recordAccessByTableId.has(targetTableId))) continue;
    if (tableKinds.get(targetTableId) === "federated") {
      federatedTableIds.push(targetTableId);
      continue;
    }
    if (tableKinds.get(targetTableId) === "stored") {
      storedTableIds.push(targetTableId);
      for (const id of ids) storedRecordIds.add(id);
    }
  }

  if (storedTableIds.length > 0 && storedRecordIds.size > 0) {
    const accessClause = storedTableIds
      .map((tableId) => sql`(r.table_id = ${tableId}::uuid AND ${recordAccessPredicate(recordAccessByTableId?.get(tableId), "r")})`)
      .reduce((left, right) => sql`${left} OR ${right}`);
    const storedRows = await sql<Array<{ id: string; table_id: string; data: unknown }>>`
      SELECT r.id, r.table_id, r.data
      FROM grids.records r
      ${liveRecordParentJoinSql("r", "rt", "rb")}
      WHERE r.id = ANY(${toPgUuidArray([...storedRecordIds])}::uuid[])
        AND r.table_id = ANY(${toPgUuidArray(storedTableIds)}::uuid[])
        AND r.deleted_at IS NULL
        AND (${accessClause})
    `;
    for (const row of storedRows) {
      const targets = targetsByTable.get(row.table_id);
      if (!targets || !idsByTargetTable.get(row.table_id)?.has(row.id)) continue;
      targets.records.push({
        id: row.id,
        data: parseJsonbRow<Record<string, unknown>>(row.data, {}),
      });
    }
  }

  for (const targetTableId of federatedTableIds) {
    const allFields = fieldsByTable.get(targetTableId) ?? [];
    const recordSource = await buildDslSqlRecordSource(targetTableId, { [targetTableId]: allFields });
    if (!recordSource) continue;
    await assertFederatedPublication(recordSource);
    const ids = idsByTargetTable.get(targetTableId)!;
    const rows = await sql<Array<{ id: string; data: unknown }>>`
      SELECT r.id, r.data
      FROM ${recordSource.relation} r
      WHERE r.id = ANY(${toPgUuidArray([...ids])}::uuid[])
        AND r.deleted_at IS NULL
        AND ${recordAccessPredicate(recordAccessByTableId?.get(targetTableId), "r")}
    `;
    targetsByTable.get(targetTableId)!.records = rows.map((row) => ({
      id: row.id,
      data: parseJsonbRow<Record<string, unknown>>(row.data, {}),
    }));
  }
  return targetsByTable;
};

export const loadRelationTargets = async (
  targetTableId: string,
  ids: Set<string>,
  recordAccess?: AuthorizedRecordAccess,
): Promise<RelationTargets> => {
  const targets = await loadRelationTargetsBatch(
    new Map([[targetTableId, ids]]),
    recordAccess ? new Map([[targetTableId, recordAccess]]) : undefined,
  );
  return targets.get(targetTableId) ?? { fields: [], records: [] };
};
