import { sql } from "bun";
import { listByTable as listFields } from "./fields";
import { parseJsonbRow } from "./jsonb";
import { liveRecordParentJoinSql } from "./parent-checks";
import { type ExpansionViewer, filterRelationTargetsByViewer } from "./relation-access";
import { collectRelationTargetIds, loadRelationTargets, relationLabelFields } from "./relation-targets";
import type { Field, GridRecord } from "./types";

export { relationLabelFields } from "./relation-targets";

type DbRow = Record<string, unknown>;
const LABEL_TEXT_TYPES = new Set(["text"]);

const formatLabelPart = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatLabelPart).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.label === "string") return object.label;
    if (typeof object.amount === "string") return object.amount;
    return "";
  }
  return String(value);
};

const resolveLabelsByTargetTable = async (idsByTargetTable: Map<string, Set<string>>): Promise<Record<string, string>> => {
  const labels: Record<string, string> = {};
  for (const [targetTableId, ids] of idsByTargetTable) {
    const targets = await loadRelationTargets(targetTableId, ids);
    for (const record of targets.records) {
      const parts = targets.fields.map((field) => formatLabelPart(record.data[field.id])).filter((part) => part.length > 0);
      labels[record.id] = parts.length > 0 ? parts.join(" · ") : "Untitled record";
    }
  }
  return labels;
};

const visibleTargetIds = async (idsByTargetTable: Map<string, Set<string>>, viewer?: ExpansionViewer): Promise<Map<string, Set<string>>> =>
  viewer ? filterRelationTargetsByViewer(idsByTargetTable, viewer) : idsByTargetTable;

export const buildRelationLabelCache = async (
  records: GridRecord[],
  fields: Field[],
  viewer?: ExpansionViewer,
): Promise<Record<string, string>> => {
  const idsByTargetTable = await collectRelationTargetIds(records, fields);
  return resolveLabelsByTargetTable(await visibleTargetIds(idsByTargetTable, viewer));
};

export const buildLabelCacheForGroupedKeys = async (
  buckets: Array<{ keys: unknown[] }>,
  groupByFieldIds: string[],
  fields: Field[],
  viewer?: ExpansionViewer,
): Promise<Record<string, string>> => {
  if (buckets.length === 0) return {};
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const idsByTargetTable = new Map<string, Set<string>>();
  for (let index = 0; index < groupByFieldIds.length; index++) {
    const field = fieldsById.get(groupByFieldIds[index]!);
    if (!field || field.type !== "relation" || field.deletedAt) continue;
    const targetTableId = (field.config as { targetTableId?: string }).targetTableId;
    if (!targetTableId) continue;
    const ids = idsByTargetTable.get(targetTableId) ?? new Set<string>();
    for (const bucket of buckets) {
      const key = bucket.keys[index];
      if (typeof key === "string" && key.length > 0) ids.add(key);
    }
    idsByTargetTable.set(targetTableId, ids);
  }
  return resolveLabelsByTargetTable(await visibleTargetIds(idsByTargetTable, viewer));
};

export const buildRelationLabelCacheForIds = async (
  idsByTargetTable: Map<string, Set<string>>,
  viewer?: ExpansionViewer,
): Promise<Record<string, string>> => resolveLabelsByTargetTable(await visibleTargetIds(idsByTargetTable, viewer));

export const lookupRecords = async (params: {
  targetTableId: string;
  q?: string | null;
  limit?: number;
  excludeIds?: string[];
}): Promise<{ items: { id: string; label: string }[] }> => {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const presentable = relationLabelFields(await listFields(params.targetTableId));
  const searchTargets = presentable.filter((field) => LABEL_TEXT_TYPES.has(field.type));
  const conditions: any[] = [sql`r.table_id = ${params.targetTableId}::uuid`, sql`r.deleted_at IS NULL`];
  const query = params.q?.trim();
  if (query && searchTargets.length > 0) {
    const pattern = `%${query.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const search = searchTargets
      .map((field) => sql`r.data->>${field.id} ILIKE ${pattern}`)
      .reduce((left, right) => sql`${left} OR ${right}`);
    conditions.push(sql`(${search})`);
  }
  if (params.excludeIds && params.excludeIds.length > 0) {
    conditions.push(sql`r.id <> ALL(${sql.array(params.excludeIds, "UUID")})`);
  }
  const where = conditions.reduce((left, right) => sql`${left} AND ${right}`);
  const rows = await sql<DbRow[]>`
    SELECT r.id, r.data
    FROM grids.records r
    ${liveRecordParentJoinSql("r", "rt", "rb")}
    WHERE ${where}
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `;
  return {
    items: rows.map((row) => {
      const data = parseJsonbRow<Record<string, unknown>>(row.data, {});
      const parts = presentable.map((field) => formatLabelPart(data[field.id])).filter((part) => part.length > 0);
      return { id: row.id as string, label: parts.length > 0 ? parts.join(" · ") : "Untitled record" };
    }),
  };
};
