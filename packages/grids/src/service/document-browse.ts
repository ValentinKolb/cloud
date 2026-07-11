import { escapeLikePattern } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type { DocumentRun, DocumentRunFolder, DocumentRunSummaryList } from "../contracts";
import { type DocumentDbRow, mapDocumentRun, summarizeDocumentRun } from "./document-mappers";
import { decodeDocumentRunCursor, encodeDocumentRunCursor, normalizeDocumentTags } from "./document-run-values";

export type DocumentRunPage = {
  items: DocumentRun[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  nextCursor: string | null;
};

export type DocumentRunBrowsePage = {
  path: string[];
  folders: DocumentRunFolder[];
  items: DocumentRun[];
  total?: number;
  limit?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
};

export const listRunsForRecord = async (tableId: string, recordId: string): Promise<DocumentRun[]> => {
  const rows = await sql<DocumentDbRow[]>`
    SELECT * FROM grids.document_runs
    WHERE table_id = ${tableId}::uuid AND record_id = ${recordId}::uuid
    ORDER BY generated_at DESC, id DESC
  `;
  return rows.map(mapDocumentRun);
};

export const listRunsForWorkflowRun = async (
  workflowRunId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<DocumentRunSummaryList> => {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);
  const [{ count } = { count: 0 }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM grids.document_runs
    WHERE workflow_run_id = ${workflowRunId}::uuid
  `;
  const rows = await sql<DocumentDbRow[]>`
    SELECT * FROM grids.document_runs
    WHERE workflow_run_id = ${workflowRunId}::uuid
    ORDER BY generated_at DESC, id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  const nextOffset = offset + rows.length;
  const total = count ?? 0;
  return {
    items: rows.map((row) => summarizeDocumentRun(mapDocumentRun(row))),
    total,
    limit,
    offset,
    hasMore: nextOffset < total,
    nextOffset: nextOffset < total ? nextOffset : null,
  };
};

const documentRunWhere = (params: {
  templateId: string;
  q?: string | null;
  tags?: string[];
  year?: number | null;
  month?: number | null;
  timeZone?: string | null;
}) => {
  const timeZone = params.timeZone || "UTC";
  const conditions = [sql`template_id = ${params.templateId}::uuid`];
  const q = params.q?.trim();
  if (q) {
    const pattern = `%${escapeLikePattern(q)}%`;
    const escape = "\\";
    conditions.push(sql`(
      filename ILIKE ${pattern} ESCAPE ${escape}
      OR document_number ILIKE ${pattern} ESCAPE ${escape}
      OR EXISTS (SELECT 1 FROM unnest(tags) tag WHERE tag ILIKE ${pattern} ESCAPE ${escape})
    )`);
  }
  const tags = normalizeDocumentTags(params.tags);
  if (tags.length > 0) conditions.push(sql`tags @> ${sql.array(tags, "TEXT")}`);
  if (params.year) conditions.push(sql`EXTRACT(YEAR FROM generated_at AT TIME ZONE ${timeZone})::int = ${params.year}`);
  if (params.month) conditions.push(sql`EXTRACT(MONTH FROM generated_at AT TIME ZONE ${timeZone})::int = ${params.month}`);
  return conditions.reduce((acc, cur) => sql`${acc} AND ${cur}`);
};

export const listRunsForTemplate = async (params: {
  templateId: string;
  q?: string | null;
  tags?: string[];
  limit?: number;
  offset?: number;
  cursor?: string | null;
  year?: number | null;
  month?: number | null;
  timeZone?: string | null;
}): Promise<DocumentRunPage> => {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);
  const cursor = decodeDocumentRunCursor(params.cursor);
  const baseWhere = documentRunWhere(params);
  const where = cursor ? sql`${baseWhere} AND (generated_at, id) < (${cursor.generatedAt}::timestamptz, ${cursor.id}::uuid)` : baseWhere;
  const [countRow] = await sql<Array<{ total: number | string }>>`
    SELECT COUNT(*)::int AS total
    FROM grids.document_runs
    WHERE ${baseWhere}
  `;
  const rows = await sql<DocumentDbRow[]>`
    SELECT *
    FROM grids.document_runs
    WHERE ${where}
    ORDER BY generated_at DESC, id DESC
    LIMIT ${limit + 1}
    OFFSET ${cursor ? 0 : offset}
  `;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(mapDocumentRun);
  const total = Number(countRow?.total ?? items.length);
  const nextOffset = offset + items.length;
  const last = items.at(-1);
  return {
    items,
    total,
    limit,
    offset: cursor ? 0 : offset,
    hasMore,
    nextOffset: hasMore && !cursor ? nextOffset : null,
    nextCursor: hasMore && last ? encodeDocumentRunCursor(last) : null,
  };
};

const runFolderPath = (path: readonly string[] | null | undefined): string[] =>
  (path ?? [])
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

const monthKey = (month: number): string => String(month).padStart(2, "0");

export const browseRunsForTemplate = async (params: {
  templateId: string;
  q?: string | null;
  tags?: string[];
  path?: string[];
  limit?: number;
  cursor?: string | null;
  timeZone?: string | null;
  mode?: "list" | "folders";
}): Promise<DocumentRunBrowsePage> => {
  const path = runFolderPath(params.path);
  const q = params.q?.trim() ?? "";
  if (params.mode === "list" || q || path.length >= 2) {
    const year = path[0] ? Number(path[0]) : null;
    const month = path[1] ? Number(path[1]) : null;
    const page = await listRunsForTemplate({
      templateId: params.templateId,
      q,
      tags: params.tags,
      limit: params.limit,
      cursor: params.cursor,
      year: Number.isInteger(year) ? year : null,
      month: Number.isInteger(month) ? month : null,
      timeZone: params.timeZone,
    });
    return {
      path,
      folders: [],
      items: page.items,
      total: page.total,
      limit: page.limit,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  const timeZone = params.timeZone || "UTC";
  const where = documentRunWhere({ templateId: params.templateId, tags: params.tags, timeZone });
  if (path.length === 0) {
    const rows = await sql<Array<{ year: number | string; count: number | string }>>`
      SELECT EXTRACT(YEAR FROM generated_at AT TIME ZONE ${timeZone})::int AS year, COUNT(*)::int AS count
      FROM grids.document_runs
      WHERE ${where}
      GROUP BY year
      ORDER BY year DESC
    `;
    return {
      path,
      folders: rows.map((row) => {
        const year = String(row.year);
        return { kind: "year", key: year, label: year, path: [year], count: Number(row.count) };
      }),
      items: [],
    };
  }

  const year = Number(path[0]);
  if (!Number.isInteger(year)) return { path: [], folders: [], items: [] };
  const yearWhere = documentRunWhere({ templateId: params.templateId, tags: params.tags, year, timeZone });
  const rows = await sql<Array<{ month: number | string; count: number | string }>>`
    SELECT EXTRACT(MONTH FROM generated_at AT TIME ZONE ${timeZone})::int AS month, COUNT(*)::int AS count
    FROM grids.document_runs
    WHERE ${yearWhere}
    GROUP BY month
    ORDER BY month DESC
  `;
  return {
    path: [String(year)],
    folders: rows.map((row) => {
      const key = monthKey(Number(row.month));
      return { kind: "month", key, label: key, path: [String(year), key], count: Number(row.count) };
    }),
    items: [],
  };
};
