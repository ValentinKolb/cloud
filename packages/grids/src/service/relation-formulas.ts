import type { ComputedColumnSpec } from "../contracts";
import { evaluate, renderResult } from "../formula/evaluator";
import type { FormulaRuntimeContext } from "../formula/functions";
import { collectFieldRefs, parseFormula } from "../formula/parser";
import { formulaError } from "../formula/types";
import { normalizeRefKey } from "../ref-syntax";
import type { Field, GridRecord } from "./types";

const formulaSlugMap = (fields: Field[]): Record<string, string> => {
  const slugToId: Record<string, string> = {};
  for (const field of fields) {
    if (field.deletedAt) continue;
    if (field.shortId) {
      slugToId[field.shortId] = field.id;
      slugToId[normalizeRefKey(field.shortId)] = field.id;
    }
    slugToId[normalizeRefKey(field.name)] = field.id;
  }
  return slugToId;
};

const orderFormulasByDeps = (
  formulaFields: Field[],
  slugToId: Record<string, string>,
): {
  ordered: Array<{
    field: Field;
    ast: ReturnType<typeof parseFormula> extends infer R ? (R extends { ok: true; ast: infer A } ? A : never) : never;
  }>;
  cycle: Set<string>;
} => {
  const resolveRef = (ref: string): string => slugToId[ref] ?? slugToId[normalizeRefKey(ref)] ?? ref;
  const compiled = formulaFields
    .map((field) => {
      const expression = (field.config as { expression?: string }).expression;
      if (!expression) return null;
      const parsed = parseFormula(expression);
      if (!parsed.ok) return null;
      const refs = new Set([...collectFieldRefs(parsed.ast)].map(resolveRef));
      return { field, ast: parsed.ast, refs };
    })
    .filter((formula): formula is NonNullable<typeof formula> => formula !== null);

  const formulaIds = new Set(compiled.map((formula) => formula.field.id));
  const byId = new Map(compiled.map((formula) => [formula.field.id, formula]));
  const ordered: typeof compiled = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycle = new Set<string>();

  // DFS keeps dependency order and marks every member of a back-edge cycle.
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (onStack.has(id)) {
      const startIndex = stack.indexOf(id);
      for (let index = startIndex; index < stack.length; index++) cycle.add(stack[index]!);
      return;
    }
    const formula = byId.get(id);
    if (!formula) return;
    stack.push(id);
    onStack.add(id);
    for (const ref of formula.refs) {
      if (formulaIds.has(ref)) visit(ref);
    }
    stack.pop();
    onStack.delete(id);
    visited.add(id);
    ordered.push(formula);
  };
  for (const formula of compiled) visit(formula.field.id);

  return { ordered, cycle };
};

export const enrichRecordsWithFormulas = (
  records: GridRecord[],
  fields: Field[],
  options: FormulaRuntimeContext & { skipFormulaFieldIds?: ReadonlySet<string> } = {},
): GridRecord[] => {
  const formulaFields = fields.filter(
    (field) => !field.deletedAt && field.type === "formula" && !options.skipFormulaFieldIds?.has(field.id),
  );
  if (formulaFields.length === 0) return records;

  const slugToId = formulaSlugMap(fields);
  const { ordered, cycle } = orderFormulasByDeps(formulaFields, slugToId);

  for (const record of records) {
    // Keep raw evaluator values in scratch so errors propagate before display rendering.
    const scratch: Record<string, unknown> = { ...record.data };
    for (const id of cycle) scratch[id] = formulaError("CYCLE");
    for (const { field, ast } of ordered) {
      if (cycle.has(field.id)) continue;
      scratch[field.id] = evaluate(ast, { fields: scratch, slugToId, dateConfig: options.dateConfig, now: options.now });
    }
    for (const { field } of ordered) record.data[field.id] = renderResult(scratch[field.id]);
    for (const id of cycle) record.data[id] = renderResult(scratch[id]);
  }
  return records;
};

export const enrichRecordsWithComputedColumns = (
  records: GridRecord[],
  fields: Field[],
  columns: ComputedColumnSpec[] | undefined,
  options: FormulaRuntimeContext & { skipColumnIds?: ReadonlySet<string> } = {},
): GridRecord[] => {
  const computedColumns = (columns ?? []).filter((column) => column.expression.trim().length > 0 && !options.skipColumnIds?.has(column.id));
  if (computedColumns.length === 0 || records.length === 0) return records;

  const slugToId = formulaSlugMap(fields);
  const compiled = computedColumns.map((column) => ({ column, parsed: parseFormula(column.expression) }));

  for (const record of records) {
    const scratch: Record<string, unknown> = { ...record.data };
    for (const { column, parsed } of compiled) {
      if (!parsed.ok) {
        record.data[column.id] = renderResult(formulaError("ERROR"));
        continue;
      }
      const value = evaluate(parsed.ast, { fields: scratch, slugToId, dateConfig: options.dateConfig, now: options.now });
      scratch[column.id] = value;
      record.data[column.id] = renderResult(value);
    }
  }
  return records;
};
