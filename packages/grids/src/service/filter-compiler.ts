import type { FilterTree } from "../contracts";
import { filterOperatorsForType, validateFilterValue } from "./filter-compiler-validation";
import type { Field } from "./types";

type FilterGroup = Extract<FilterTree, { filters: FilterTree[] }>;

export type CompiledClause =
  | { kind: "true" }
  | { kind: "false" }
  | { kind: "and"; parts: CompiledClause[] }
  | { kind: "or"; parts: CompiledClause[] }
  | { kind: "not"; inner: CompiledClause }
  | {
      kind: "predicate";
      fieldId: string;
      fieldType: string;
      op: string;
      value?: unknown;
      caseInsensitive?: boolean;
      dateIncludeTime?: boolean;
      timeZone?: string;
    };

type CompileResult = { ok: true; clause: CompiledClause } | { ok: false; error: string };
type CompileOptions = { timeZone?: string };

const isGroup = (tree: FilterTree): tree is FilterGroup => {
  const group = tree as Partial<FilterGroup>;
  return (group.op === "AND" || group.op === "OR") && Array.isArray(group.filters);
};

const compileTree = (tree: FilterTree, fieldsById: Map<string, Field>, options: CompileOptions): CompileResult => {
  if (isGroup(tree)) {
    if (tree.filters.length === 0) return { ok: true, clause: { kind: tree.op === "AND" ? "true" : "false" } };
    const parts: CompiledClause[] = [];
    for (const child of tree.filters) {
      const compiled = compileTree(child, fieldsById, options);
      if (!compiled.ok) return compiled;
      parts.push(compiled.clause);
    }
    return { ok: true, clause: { kind: tree.op === "AND" ? "and" : "or", parts } };
  }

  const field = fieldsById.get(tree.fieldId);
  if (!field) return { ok: false, error: "unknown field" };
  if (field.deletedAt) return { ok: false, error: `field "${field.name}" is deleted` };
  if (!filterOperatorsForType(field.type).has(tree.op)) {
    return { ok: false, error: `op "${tree.op}" not supported for type "${field.type}"` };
  }

  const dateIncludeTime = field.type === "date" ? Boolean((field.config as { includeTime?: boolean }).includeTime) : undefined;
  const valueError = validateFilterValue(field.type, tree.op, tree.value, dateIncludeTime);
  if (valueError) return { ok: false, error: `field "${field.name}" / op "${tree.op}": ${valueError}` };

  return {
    ok: true,
    clause: {
      kind: "predicate",
      fieldId: field.id,
      fieldType: field.type,
      op: tree.op,
      value: tree.value,
      caseInsensitive: tree.caseInsensitive,
      ...(field.type === "date" ? { dateIncludeTime, timeZone: options.timeZone ?? "UTC" } : {}),
    },
  };
};

export const compileFilter = (tree: FilterTree | null | undefined, fields: Field[], options: CompileOptions = {}): CompileResult => {
  if (tree === null || tree === undefined) return { ok: true, clause: { kind: "true" } };
  return compileTree(tree, new Map(fields.map((field) => [field.id, field])), options);
};

export { renderClause } from "./filter-compiler-render";
