import type { DateContext } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { lookupTargetMeta } from "../lookup-display";
import {
  applyComputedProjections,
  buildComputedProjections,
  buildFormulaSqlProjections,
  type ComputedProjection,
} from "./computed-projections";
import { listByTable as listFields } from "./fields";
import { withLookupTargetMetadata } from "./lookup-display";
import { liveRecordParentJoinSql } from "./parent-checks";
import { mapRecordRow } from "./record-persistence";
import { attachRelationExpansion, type ExpansionViewer, enrichRecordsWithFormulas, hydrateRelationsFromLinks } from "./relations";
import type { Field, GridRecord } from "./types";

type DbRow = Record<string, unknown>;

const relationIdsFor = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? [value] : [];

export const projectionFragmentsFor = (projections: ComputedProjection[]): unknown =>
  projections.length > 0
    ? projections.map((projection) => sql`, ${projection.fragment}`).reduce((acc, current) => sql`${acc}${current}`)
    : sql``;

export const enrichFormulaLookups = async (
  records: GridRecord[],
  fields: Field[],
  options: { dateConfig?: DateContext } = {},
): Promise<void> => {
  if (records.length === 0) return;
  const specs = fields
    .filter((field) => field.type === "lookup" && !field.deletedAt && lookupTargetMeta(field)?.type === "formula")
    .map((lookupField) => {
      const cfg = lookupField.config as { relationFieldId?: string };
      const relationField = cfg.relationFieldId
        ? fields.find((field) => field.id === cfg.relationFieldId && field.type === "relation")
        : undefined;
      const target = lookupTargetMeta(lookupField);
      const targetTableId = (relationField?.config as { targetTableId?: string } | undefined)?.targetTableId;
      return relationField && target && targetTableId ? { lookupField, relationField, target, targetTableId } : null;
    })
    .filter((spec): spec is NonNullable<typeof spec> => Boolean(spec));
  if (specs.length === 0) return;

  const idsByTable = new Map<string, Set<string>>();
  for (const spec of specs) {
    const ids = idsByTable.get(spec.targetTableId) ?? new Set<string>();
    for (const record of records) {
      for (const id of relationIdsFor(record.data[spec.relationField.id])) ids.add(id);
    }
    idsByTable.set(spec.targetTableId, ids);
  }

  const targetsByTable = new Map<string, Map<string, GridRecord>>();
  for (const [tableId, ids] of idsByTable) {
    if (ids.size === 0) continue;
    const targetFields = await listFields(tableId);
    const targetComputed = await buildComputedProjections(targetFields);
    const targetFormulaSql = buildFormulaSqlProjections(targetFields, { dateConfig: options.dateConfig });
    const targetProjections = [...targetComputed, ...targetFormulaSql];
    const projectionFragments = projectionFragmentsFor(targetProjections);
    const rows = await sql<DbRow[]>`
      SELECT r.*${projectionFragments}
      FROM grids.records r
      ${liveRecordParentJoinSql("r", "rt", "rb")}
      WHERE r.table_id = ${tableId}::uuid
        AND r.id = ANY(${sql.array([...ids], "UUID")})
        AND r.deleted_at IS NULL
    `;
    const targetRecords = rows.map(mapRecordRow);
    await hydrateRelationsFromLinks(targetRecords, targetFields);
    const recordsById = new Map(targetRecords.map((record) => [record.id, record]));
    applyComputedProjections(rows as Array<Record<string, unknown>>, recordsById, targetProjections);
    enrichRecordsWithFormulas(targetRecords, targetFields, {
      dateConfig: options.dateConfig,
      skipFormulaFieldIds: new Set(targetFormulaSql.map((projection) => projection.fieldId)),
    });
    targetsByTable.set(tableId, recordsById);
  }

  for (const spec of specs) {
    const targetRecords = targetsByTable.get(spec.targetTableId);
    for (const record of records) {
      const firstId = relationIdsFor(record.data[spec.relationField.id])[0];
      record.data[spec.lookupField.id] = firstId ? (targetRecords?.get(firstId)?.data[spec.target.fieldId] ?? null) : null;
    }
  }
};

export const get = async (
  tableId: string,
  recordId: string,
  opts: { includeRelations?: boolean; viewer?: ExpansionViewer; dateConfig?: DateContext } = {},
): Promise<GridRecord | null> => {
  const fields = await listFields(tableId);
  const fieldsWithLookupMeta = await withLookupTargetMetadata(fields);
  const computed = await buildComputedProjections(fields);
  const formulaSql = buildFormulaSqlProjections(fields, { dateConfig: opts.dateConfig });
  const projections = [...computed, ...formulaSql];
  const projectionFragments = projectionFragmentsFor(projections);

  const [row] = await sql<DbRow[]>`
    SELECT r.*${projectionFragments}
    FROM grids.records r
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE r.id = ${recordId}::uuid
      AND r.table_id = ${tableId}::uuid
      AND r.deleted_at IS NULL
  `;
  if (!row) return null;
  const record = mapRecordRow(row);
  await hydrateRelationsFromLinks([record], fields);
  applyComputedProjections([row as Record<string, unknown>], new Map([[record.id, record]]), projections);
  await enrichFormulaLookups([record], fieldsWithLookupMeta, { dateConfig: opts.dateConfig });
  enrichRecordsWithFormulas([record], fieldsWithLookupMeta, {
    dateConfig: opts.dateConfig,
    skipFormulaFieldIds: new Set(formulaSql.map((projection) => projection.fieldId)),
  });
  if (opts.includeRelations) {
    await attachRelationExpansion([record], fieldsWithLookupMeta, opts.viewer);
  }
  return record;
};
