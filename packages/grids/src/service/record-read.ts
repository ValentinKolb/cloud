import type { DateContext } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { type LookupTargetMeta, lookupTargetMeta } from "../lookup-display";
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

type FormulaLookupSpec = {
  lookupField: Field;
  relationField: Field;
  target: LookupTargetMeta;
  targetTableId: string;
};

type FormulaLookupTargetPlan = {
  fields: Field[];
  projections: ComputedProjection[];
  projectionFragments: unknown;
  formulaFieldIds: Set<string>;
};

type FormulaLookupPlan = {
  specs: FormulaLookupSpec[];
  targets: Map<string, FormulaLookupTargetPlan>;
};

const prepareFormulaLookupPlan = async (fields: Field[], dateConfig?: DateContext): Promise<FormulaLookupPlan> => {
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

  const targets = new Map<string, FormulaLookupTargetPlan>();
  for (const { targetTableId } of specs) {
    if (targets.has(targetTableId)) continue;
    const targetFields = await listFields(targetTableId);
    const targetComputed = await buildComputedProjections(targetFields);
    const targetFormulaSql = buildFormulaSqlProjections(targetFields, { dateConfig });
    const targetProjections = [...targetComputed, ...targetFormulaSql];
    targets.set(targetTableId, {
      fields: targetFields,
      projections: targetProjections,
      projectionFragments: projectionFragmentsFor(targetProjections),
      formulaFieldIds: new Set(targetFormulaSql.map((projection) => projection.fieldId)),
    });
  }
  return { specs, targets };
};

const enrichFormulaLookupsWithPlan = async (
  records: GridRecord[],
  plan: FormulaLookupPlan,
  options: { dateConfig?: DateContext } = {},
): Promise<void> => {
  if (records.length === 0 || plan.specs.length === 0) return;

  const idsByTable = new Map<string, Set<string>>();
  for (const spec of plan.specs) {
    const ids = idsByTable.get(spec.targetTableId) ?? new Set<string>();
    for (const record of records) {
      for (const id of relationIdsFor(record.data[spec.relationField.id])) ids.add(id);
    }
    idsByTable.set(spec.targetTableId, ids);
  }

  const targetsByTable = new Map<string, Map<string, GridRecord>>();
  for (const [tableId, ids] of idsByTable) {
    if (ids.size === 0) continue;
    const target = plan.targets.get(tableId);
    if (!target) continue;
    const rows = await sql<DbRow[]>`
      SELECT r.*${target.projectionFragments}
      FROM grids.records r
      ${liveRecordParentJoinSql("r", "rt", "rb")}
      WHERE r.table_id = ${tableId}::uuid
        AND r.id = ANY(${sql.array([...ids], "UUID")})
        AND r.deleted_at IS NULL
    `;
    const targetRecords = rows.map(mapRecordRow);
    await hydrateRelationsFromLinks(targetRecords, target.fields);
    const recordsById = new Map(targetRecords.map((record) => [record.id, record]));
    applyComputedProjections(rows as Array<Record<string, unknown>>, recordsById, target.projections);
    enrichRecordsWithFormulas(targetRecords, target.fields, {
      dateConfig: options.dateConfig,
      skipFormulaFieldIds: target.formulaFieldIds,
    });
    targetsByTable.set(tableId, recordsById);
  }

  for (const spec of plan.specs) {
    const targetRecords = targetsByTable.get(spec.targetTableId);
    for (const record of records) {
      const firstId = relationIdsFor(record.data[spec.relationField.id])[0];
      record.data[spec.lookupField.id] = firstId ? (targetRecords?.get(firstId)?.data[spec.target.fieldId] ?? null) : null;
    }
  }
};

export const enrichFormulaLookups = async (
  records: GridRecord[],
  fields: Field[],
  options: { dateConfig?: DateContext } = {},
): Promise<void> => {
  if (records.length === 0) return;
  const plan = await prepareFormulaLookupPlan(fields, options.dateConfig);
  await enrichFormulaLookupsWithPlan(records, plan, options);
};

type RecordReadOptions = {
  includeRelations?: boolean;
  viewer?: ExpansionViewer;
  dateConfig?: DateContext;
  fields?: Field[];
};

export type RecordReader = {
  fields: Field[];
  get: (recordId: string) => Promise<GridRecord | null>;
  getMany: (recordIds: string[]) => Promise<GridRecord[]>;
};

export const createReader = async (tableId: string, opts: RecordReadOptions = {}): Promise<RecordReader> => {
  const fields = opts.fields ?? (await listFields(tableId));
  const fieldsWithLookupMeta = await withLookupTargetMetadata(fields);
  const computed = await buildComputedProjections(fields);
  const formulaSql = buildFormulaSqlProjections(fields, { dateConfig: opts.dateConfig });
  const projections = [...computed, ...formulaSql];
  const projectionFragments = projectionFragmentsFor(projections);
  const formulaFieldIds = new Set(formulaSql.map((projection) => projection.fieldId));
  const formulaLookupPlan = await prepareFormulaLookupPlan(fieldsWithLookupMeta, opts.dateConfig);

  const getMany = async (recordIds: string[]): Promise<GridRecord[]> => {
    if (recordIds.length === 0) return [];
    const rows = await sql<DbRow[]>`
      SELECT r.*${projectionFragments}
      FROM grids.records r
      JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
      JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
      WHERE r.id = ANY(${sql.array(recordIds, "UUID")}::uuid[])
        AND r.table_id = ${tableId}::uuid
        AND r.deleted_at IS NULL
    `;
    const records = rows.map(mapRecordRow);
    await hydrateRelationsFromLinks(records, fields);
    const recordsById = new Map(records.map((record) => [record.id, record]));
    applyComputedProjections(rows as Array<Record<string, unknown>>, recordsById, projections);
    await enrichFormulaLookupsWithPlan(records, formulaLookupPlan, { dateConfig: opts.dateConfig });
    enrichRecordsWithFormulas(records, fieldsWithLookupMeta, {
      dateConfig: opts.dateConfig,
      skipFormulaFieldIds: formulaFieldIds,
    });
    if (opts.includeRelations) {
      await attachRelationExpansion(records, fieldsWithLookupMeta, opts.viewer);
    }
    return recordIds.flatMap((id) => {
      const record = recordsById.get(id);
      return record ? [record] : [];
    });
  };

  return {
    fields,
    get: async (recordId) => (await getMany([recordId]))[0] ?? null,
    getMany,
  };
};

export const get = async (tableId: string, recordId: string, opts: RecordReadOptions = {}): Promise<GridRecord | null> =>
  (await createReader(tableId, opts)).get(recordId);
