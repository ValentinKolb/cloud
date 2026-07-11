import { type ExpansionViewer, filterRelationTargetsByViewer } from "./relation-access";
import { collectRelationTargetIds, loadRelationTargets } from "./relation-targets";
import type { Field, GridRecord } from "./types";

const resolveExpansionByTargetTable = async (
  idsByTargetTable: Map<string, Set<string>>,
): Promise<Record<string, Record<string, unknown>>> => {
  const expansion: Record<string, Record<string, unknown>> = {};
  for (const [targetTableId, ids] of idsByTargetTable) {
    const targets = await loadRelationTargets(targetTableId, ids);
    for (const record of targets.records) {
      const visibleFields: Record<string, unknown> = {};
      for (const field of targets.fields) {
        const value = record.data[field.id];
        if (value !== null && value !== undefined && value !== "") visibleFields[field.id] = value;
      }
      if (Object.keys(visibleFields).length > 0) expansion[record.id] = visibleFields;
    }
  }
  return expansion;
};

export const buildRelationExpansionCache = async (
  records: GridRecord[],
  fields: Field[],
  viewer?: ExpansionViewer,
): Promise<Record<string, Record<string, unknown>>> => {
  const idsByTargetTable = await collectRelationTargetIds(records, fields);
  const visibleTargets = viewer ? await filterRelationTargetsByViewer(idsByTargetTable, viewer) : idsByTargetTable;
  return resolveExpansionByTargetTable(visibleTargets);
};

export const attachRelationExpansion = async (records: GridRecord[], fields: Field[], viewer?: ExpansionViewer): Promise<void> => {
  if (records.length === 0) return;
  const expansion = await buildRelationExpansionCache(records, fields, viewer);
  if (Object.keys(expansion).length === 0) return;
  const relationFieldIds = fields.filter((field) => field.type === "relation" && !field.deletedAt).map((field) => field.id);
  if (relationFieldIds.length === 0) return;

  for (const record of records) {
    const linkedIds: string[] = [];
    for (const fieldId of relationFieldIds) {
      const value = record.data[fieldId];
      if (Array.isArray(value)) {
        for (const id of value) {
          if (typeof id === "string") linkedIds.push(id);
        }
      } else if (typeof value === "string") {
        linkedIds.push(value);
      }
    }
    const subset: Record<string, Record<string, unknown>> = {};
    for (const id of linkedIds) {
      const expanded = expansion[id];
      if (expanded) subset[id] = expanded;
    }
    if (Object.keys(subset).length > 0) record.expanded = subset;
  }
};
