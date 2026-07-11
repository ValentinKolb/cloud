import type { DslQueryPreviewResponse } from "../../../contracts";
import type { Field, Table, View } from "../../../service";

export type QueryWorkspaceCurrentSource =
  | { kind: "table"; tableId: string; label: string; ref: string }
  | { kind: "view"; viewId: string; label: string; ref: string };

type QueryWorkspaceApiSource = { kind: "table"; tableId: string } | { kind: "view"; viewId: string };

export const currentSourceForApi = (source: QueryWorkspaceCurrentSource | undefined): QueryWorkspaceApiSource | undefined => {
  if (!source) return undefined;
  return source.kind === "table" ? { kind: "table", tableId: source.tableId } : { kind: "view", viewId: source.viewId };
};

type QueryTextStats = {
  chars: number;
  lines: number;
  nonEmptyLines: number;
  clauses: number;
};

const CLAUSE_START =
  /^(?:from|select|join|left\s+join|where|group\s+by|aggregate|having|sort|search|limit|offset|include\s+deleted|deleted\s+only)\b/i;

export const queryTextStats = (query: string): QueryTextStats => {
  const lines = query.length === 0 ? [] : query.split(/\r\n|\r|\n/);
  const segments = query
    .split(/[\r\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    chars: query.length,
    lines: Math.max(1, lines.length),
    nonEmptyLines: lines.filter((line) => line.trim().length > 0).length,
    clauses: segments.filter((line) => CLAUSE_START.test(line)).length,
  };
};

type PreviewSummary =
  | { kind: "idle"; label: "No result"; tone: "muted" }
  | { kind: "checking"; label: "Checking"; tone: "pending" }
  | { kind: "issues"; label: "Issues"; tone: "danger"; diagnostics: number }
  | {
      kind: "ready";
      label: "Ready";
      tone: "success";
      rows: number;
      columns: number;
      mode: "rows" | "groups";
      truncated: boolean;
      explode: boolean;
      limit?: number;
    };

export const previewSummary = (preview: DslQueryPreviewResponse | null, loading: boolean): PreviewSummary => {
  if (loading) return { kind: "checking", label: "Checking", tone: "pending" };
  if (!preview) return { kind: "idle", label: "No result", tone: "muted" };
  if (!preview.ok) return { kind: "issues", label: "Issues", tone: "danger", diagnostics: preview.diagnostics.length };
  return {
    kind: "ready",
    label: "Ready",
    tone: "success",
    rows: preview.rows.length,
    columns: preview.columns.length,
    mode: preview.mode,
    truncated: preview.truncated === true,
    explode: preview.explode === true,
    limit: preview.limit,
  };
};

type SourceCatalogSummary = {
  tables: number;
  fields: number;
  views: number;
};

export const visibleFields = (fields: Field[] | undefined): Field[] => (fields ?? []).filter((field) => !field.deletedAt);
export const visibleViews = (views: View[] | undefined): View[] => (views ?? []).filter((view) => !view.deletedAt);

export const sourceCatalogSummary = (
  tables: Table[],
  fieldsByTable: Record<string, Field[]>,
  viewsByTable: Record<string, View[]>,
): SourceCatalogSummary => {
  const visibleTables = tables.filter((table) => !table.deletedAt);
  return {
    tables: visibleTables.length,
    fields: visibleTables.reduce((sum, table) => sum + visibleFields(fieldsByTable[table.id]).length, 0),
    views: visibleTables.reduce((sum, table) => sum + visibleViews(viewsByTable[table.id]).length, 0),
  };
};
