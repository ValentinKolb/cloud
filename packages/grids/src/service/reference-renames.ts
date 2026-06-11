import { sql } from "bun";
import { ViewQuerySchema, type ComputedColumnSpec, type ViewQuery } from "../contracts";
import { parseFormula } from "../formula/parser";
import { rewriteFormulaIdentifierRefs } from "../ref-rewrite";
import type { SqlClient } from "./audit";
import { parseJsonbRow } from "./jsonb";

type DbRow = Record<string, unknown>;

const rewriteExpression = (expression: unknown, rename: { oldName: string; newName: string }): string | null => {
  if (typeof expression !== "string" || expression.trim().length === 0) return null;
  const rewritten = rewriteFormulaIdentifierRefs(expression, rename);
  if (!rewritten.changed) return null;
  if (!parseFormula(rewritten.text).ok) {
    throw new Error(`rewritten formula expression is invalid for renamed field "${rename.newName}"`);
  }
  return rewritten.text;
};

const rewriteComputedColumns = (query: ViewQuery, rename: { oldName: string; newName: string }): ViewQuery | null => {
  let changed = false;
  const columns = query.columns?.map((column) => {
    if (!("kind" in column) || column.kind !== "computed") return column;
    const expression = rewriteExpression(column.expression, rename);
    if (!expression) return column;
    changed = true;
    return { ...column, expression } satisfies ComputedColumnSpec;
  });
  return changed ? { ...query, columns } : null;
};

export const rewriteFieldNameReferences = async (params: {
  tableId: string;
  oldName: string;
  newName: string;
}, client: SqlClient = sql): Promise<void> => {
  const formulaRows = await client<DbRow[]>`
    SELECT id::text AS id, config
    FROM grids.fields
    WHERE table_id = ${params.tableId}::uuid
      AND type = 'formula'
      AND deleted_at IS NULL
  `;

  for (const row of formulaRows) {
    const config = parseJsonbRow<Record<string, unknown>>(row.config, {});
    const expression = rewriteExpression(config.expression, params);
    if (!expression) continue;
    await client`
      UPDATE grids.fields
      SET config = ${JSON.stringify({ ...config, expression })}::jsonb,
          updated_at = now()
      WHERE id = ${row.id}::uuid
    `;
  }

  const viewRows = await client<DbRow[]>`
    SELECT id::text AS id, query
    FROM grids.views
    WHERE table_id = ${params.tableId}::uuid
      AND deleted_at IS NULL
  `;

  for (const row of viewRows) {
    const parsed = ViewQuerySchema.safeParse(parseJsonbRow<unknown>(row.query, {}));
    if (!parsed.success) continue;
    const query = rewriteComputedColumns(parsed.data, params);
    if (!query) continue;
    await client`
      UPDATE grids.views
      SET query = ${query}::jsonb,
          updated_at = now()
      WHERE id = ${row.id}::uuid
    `;
  }
};
