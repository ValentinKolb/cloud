import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { listByTable as listFields } from "./fields";
import { parseJsonbRow } from "./jsonb";
import { liveRecordParentJoinSql } from "./parent-checks";
import { readRecordLinksBatch } from "./relation-links";
import type { Field, GridRecord } from "./types";

const LABEL_TEXT_TYPES = new Set(["text"]);

export const relationLabelFields = (fields: Field[]): Field[] => {
  const alive = fields.filter((field) => !field.deletedAt).sort((left, right) => left.position - right.position);
  const presentable = alive.filter((field) => field.presentable);
  if (presentable.length > 0) return presentable;
  const firstText = alive.find((field) => LABEL_TEXT_TYPES.has(field.type));
  return firstText ? [firstText] : [];
};

export const collectRelationTargetIds = async (records: GridRecord[], fields: Field[]): Promise<Map<string, Set<string>>> => {
  const relationFields = fields.filter((field) => field.type === "relation" && !field.deletedAt);
  if (relationFields.length === 0 || records.length === 0) return new Map();
  const links = await readRecordLinksBatch(
    records.map((record) => record.id),
    relationFields.map((field) => field.id),
  );
  const idsByTargetTable = new Map<string, Set<string>>();
  for (const field of relationFields) {
    const targetTableId = (field.config as { targetTableId?: string }).targetTableId;
    if (!targetTableId) continue;
    const ids = idsByTargetTable.get(targetTableId) ?? new Set<string>();
    for (const record of records) {
      for (const id of links.get(record.id)?.get(field.id) ?? []) ids.add(id);
    }
    idsByTargetTable.set(targetTableId, ids);
  }
  return idsByTargetTable;
};

export const loadRelationTargets = async (
  targetTableId: string,
  ids: Set<string>,
): Promise<{ fields: Field[]; records: Array<{ id: string; data: Record<string, unknown> }> }> => {
  const fields = relationLabelFields(await listFields(targetTableId));
  if (ids.size === 0 || fields.length === 0) return { fields, records: [] };
  const rows = await sql<Array<{ id: string; data: unknown }>>`
    SELECT r.id, r.data
    FROM grids.records r
    ${liveRecordParentJoinSql("r", "rt", "rb")}
    WHERE r.id = ANY(${toPgUuidArray([...ids])}::uuid[])
      AND r.table_id = ${targetTableId}::uuid
      AND r.deleted_at IS NULL
  `;
  return {
    fields,
    records: rows.map((row) => ({ id: row.id, data: parseJsonbRow<Record<string, unknown>>(row.data, {}) })),
  };
};
