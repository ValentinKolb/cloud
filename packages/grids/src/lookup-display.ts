export const LOOKUP_TARGET_META_KEY = "__lookupTarget";

export type LookupTargetMeta = {
  fieldId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  icon?: string | null;
};

type FieldLike = {
  id?: string;
  tableId?: string;
  name?: string;
  type: string;
  config: Record<string, unknown>;
  icon?: string | null;
};

type FieldsByTable = Record<string, FieldLike[]>;

const localLookupTargetMeta = (field: FieldLike, fieldsByTable?: FieldsByTable): LookupTargetMeta | null => {
  if (field.type !== "lookup" || !field.tableId || !fieldsByTable) return null;
  const cfg = field.config as { relationFieldId?: unknown; targetFieldId?: unknown };
  if (typeof cfg.relationFieldId !== "string" || typeof cfg.targetFieldId !== "string") return null;
  const relationField = (fieldsByTable[field.tableId] ?? []).find((candidate) => candidate.id === cfg.relationFieldId);
  const targetTableId = (relationField?.config as { targetTableId?: unknown } | undefined)?.targetTableId;
  if (typeof targetTableId !== "string") return null;
  const target = (fieldsByTable[targetTableId] ?? []).find((candidate) => candidate.id === cfg.targetFieldId);
  if (!target || !target.id) return null;
  return {
    fieldId: target.id,
    name: target.name ?? "Lookup target",
    type: target.type,
    config: target.config,
    icon: target.icon,
  };
};

export const lookupTargetMeta = (field: FieldLike, fieldsByTable?: FieldsByTable): LookupTargetMeta | null => {
  if (field.type !== "lookup") return null;
  const raw = field.config[LOOKUP_TARGET_META_KEY];
  if (!raw || typeof raw !== "object") return localLookupTargetMeta(field, fieldsByTable);
  const meta = raw as Partial<LookupTargetMeta>;
  if (typeof meta.fieldId !== "string" || typeof meta.type !== "string") return localLookupTargetMeta(field, fieldsByTable);
  return {
    fieldId: meta.fieldId,
    name: typeof meta.name === "string" ? meta.name : (field.name ?? "Lookup target"),
    type: meta.type,
    config: meta.config && typeof meta.config === "object" ? (meta.config as Record<string, unknown>) : {},
    icon: typeof meta.icon === "string" || meta.icon === null ? meta.icon : undefined,
  };
};

export const effectiveDisplayField = <T extends FieldLike>(field: T, fieldsByTable?: FieldsByTable): T => {
  const target = lookupTargetMeta(field, fieldsByTable);
  if (!target) return field;
  return {
    ...field,
    name: target.name,
    type: target.type,
    config: target.config,
    icon: target.icon,
  };
};
