import { writeFile } from "node:fs/promises";
import type { CliInputFlagValue, CloudCliContext } from "@valentinkolb/cloud/cli";
import { flag } from "@valentinkolb/cloud/cli";
import type { DslQueryExecuteResponse, Table, View } from "../contracts";
import { GRID_FORMULA_FUNCTIONS } from "../formula/function-catalog";
import { UUID_RE } from "./resources";
import { exactMatch, printDiagnostics, readApi, readTextInput } from "./runtime";

export type FormulaPreviewResponse = {
  ok: boolean;
  diagnostics: Array<{ severity: "error" | "info"; message: string }>;
  fields: Array<{ id: string; shortId: string; name: string; type: string }>;
  rows: Array<{ recordId: string; values: Record<string, unknown>; result: unknown }>;
};

export const GQL_INPUT = flag.input({
  name: "query",
  fileName: "query-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "gql",
});

export const FORMULA_INPUT = flag.input({
  name: "expression",
  fileName: "expression-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "formula",
});

export const viewFlag = {
  view: flag.string({ description: "View id, short id, or exact name" }),
};

export const GQL_REFERENCE = {
  clauses: [
    "from table <table-ref> [as alias]",
    "from view <view-ref> [as alias]",
    "select <field>, formula(<expr>) as alias",
    "join table <table-ref> as alias on <scope.field> = <alias.field>",
    "left join table <table-ref> as alias on <scope.field> = <alias.field>",
    "where <formula predicate>",
    "group by <field> [by day|week|month|quarter|year]",
    "aggregate count(*) as total, sum(<field>) as revenue",
    "having <formula predicate>",
    "sort <field-or-alias> [asc|desc] [nulls first|last]",
    "search '<text>' [in field1, field2]",
    "limit <1..10000>",
    "offset <0..10000>",
    "include deleted",
    "deleted only",
  ],
  refs: [
    "Use exact field/source names when unambiguous: Name",
    'Quote names with spaces: "Birth year"',
    "Use stable ids in braces when workflows must not break on rename: {field-uuid}",
    "Qualified refs use aliases: items.Name, author.Country",
  ],
  examples: [
    'from table Authors\nselect Name, "Birth year"\nsort "Birth year" desc\nlimit 100',
    "from table Books as books\ngroup by Published by year\naggregate count(*) as books, avg(Rating) as avgRating\nsort books desc",
    "from table Items\nsearch 'camera' in Name, Notes\nwhere Available = true\nlimit 50",
  ],
};

export const FORMULA_REFERENCE = {
  syntax: [
    'Field refs: Name, "Birth year", or {field-uuid}.',
    "Text literals use quotes: 'camera'.",
    "Operators: +, -, *, /, %, =, !=, <, <=, >, >=, and, or, not.",
    "Functions are case-insensitive. Prefer uppercase in shared docs.",
    "Formula fields, GQL where/having, computed GQL columns, and template data checks use the same expression model.",
  ],
  functions: GRID_FORMULA_FUNCTIONS,
  examples: ["LEN(Name)", "IFEMPTY(Email, 'missing')", "DATEADD(TODAY(), 30, 'days')", "ROUND(Amount * 1.19, 2)"],
};

export const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

export const listViews = (ctx: CloudCliContext, tableId: string): Promise<View[]> =>
  readApi<View[]>(ctx, `/views/by-table/${encodeURIComponent(tableId)}`);

const getViewById = (ctx: CloudCliContext, viewId: string): Promise<View> => readApi<View>(ctx, `/views/${encodeURIComponent(viewId)}`);

export const resolveView = async (ctx: CloudCliContext, tableId: string, ref: string): Promise<View> =>
  exactMatch(
    await listViews(ctx, tableId),
    ref,
    [(view) => view.id, (view) => view.shortId, (view) => view.name],
    "view",
    (view) => `${view.name} (${view.shortId})`,
  );

export const resolveOptionalView = async (ctx: CloudCliContext, table: Table | null, ref: string | undefined): Promise<View | null> => {
  if (!ref) return null;
  if (UUID_RE.test(ref)) return getViewById(ctx, ref);
  if (!table) throw new Error("Resolving a view by name or short id requires --table.");
  return resolveView(ctx, table.id, ref);
};

export const viewRows = (items: View[]) =>
  items.map((view) => ({
    shortId: view.shortId,
    name: view.name,
    scope: view.ownerUserId ? "personal" : "shared",
    updatedAt: view.updatedAt,
    id: view.id,
  }));

export const printGqlDiagnostics = (
  ctx: CloudCliContext,
  diagnostics: NonNullable<Extract<DslQueryExecuteResponse, { ok: false }>["diagnostics"]>,
) => {
  if (diagnostics.length === 0) {
    ctx.print("Query failed.");
    return;
  }
  printDiagnostics(ctx, diagnostics);
};

export const printGqlResult = (ctx: CloudCliContext, payload: DslQueryExecuteResponse): number => {
  if (ctx.options.output === "json") {
    ctx.json(payload);
    return payload.ok ? 0 : 1;
  }
  if (!payload.ok) {
    printGqlDiagnostics(ctx, payload.diagnostics);
    return 1;
  }
  const rows = payload.rows.map((row) => {
    const values: Record<string, unknown> = {
      ...(row.recordId ? { recordId: row.recordId } : {}),
      ...row.values,
    };
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, displayValue(value)]));
  });
  if (rows.length === 0) {
    ctx.print("No rows.");
    return 0;
  }
  const columns: Parameters<CloudCliContext["table"]>[1] = [
    ...(payload.rows.some((row) => row.recordId) ? [{ key: "recordId", label: "RECORD" }] : []),
    ...payload.columns.map((column) => ({ key: column.key, label: column.label })),
  ];
  ctx.table(rows, columns);
  if (payload.truncated) ctx.print(`Truncated at ${payload.limit} rows.`);
  return 0;
};

export const readGql = async (input: CliInputFlagValue): Promise<string> => {
  const query = await readTextInput(input, "GQL query", true);
  return query?.trim() ?? "";
};

export const writeOrPrint = async (ctx: CloudCliContext, text: string, out: string | undefined) => {
  if (out) {
    await writeFile(out, text);
    if (ctx.options.output === "json") ctx.json({ path: out });
    else ctx.print(`Wrote ${out}.`);
    return;
  }
  ctx.print(text);
};
