import type { DslQueryCompletionItem, DslQueryCompletionKind, DslQueryTextRange } from "../contracts";
import type { DslResolverContext } from "./resolver";

export type CompletionPurpose = "output" | "predicate" | "group" | "aggregate" | "search" | "sort" | "join";

export type CompletionRequest = {
  query: string;
  caret: number;
  ctx: DslResolverContext;
  currentSource?: { kind: "table"; tableId: string } | { kind: "view"; viewId: string };
};

export const isDiagnostic = (value: unknown): value is { message: string } =>
  typeof value === "object" && value !== null && "message" in value;

const rangeText = (query: string, range: DslQueryTextRange): string => query.slice(range.start, range.end);

const tokenNeedle = (query: string, range: DslQueryTextRange): string =>
  rangeText(query, range).replace(/^[{"]/, "").replace(/[}"]$/, "").toLowerCase();

export const matchesNeedle = (query: string, range: DslQueryTextRange, values: string[]): boolean => {
  const needle = tokenNeedle(query, range).trim();
  if (!needle) return true;
  return values.some((value) => value.toLowerCase().includes(needle));
};

const COMPLETION_KIND_ORDER: Record<DslQueryCompletionKind, number> = {
  source: 0,
  field: 0,
  column: 0,
  alias: 1,
  function: 2,
  keyword: 3,
  modifier: 4,
  literal: 5,
};

export const rankItems = (query: string, range: DslQueryTextRange, items: DslQueryCompletionItem[]): DslQueryCompletionItem[] => {
  const needle = tokenNeedle(query, range).trim();
  const score = (item: DslQueryCompletionItem) => {
    const haystack = `${item.label} ${item.detail ?? ""} ${item.insertText}`.toLowerCase();
    if (!needle) return 1;
    if (item.label.toLowerCase().startsWith(needle)) return 0;
    if (haystack.includes(needle)) return 1;
    return 2;
  };
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter((entry) => entry.score < 2)
    .sort((a, b) => a.score - b.score || COMPLETION_KIND_ORDER[a.item.kind] - COMPLETION_KIND_ORDER[b.item.kind] || a.index - b.index)
    .slice(0, 80)
    .map((entry) => entry.item);
};

export const completionItem = (
  range: DslQueryTextRange,
  kind: DslQueryCompletionKind,
  label: string,
  insertText: string,
  detail?: string,
  commitCharacters?: string[],
): DslQueryCompletionItem => ({
  label,
  kind,
  insertText,
  textEdit: { ...range, text: insertText },
  ...(detail ? { detail } : {}),
  ...(commitCharacters ? { commitCharacters } : {}),
});

export const uniqueItems = (items: DslQueryCompletionItem[]): DslQueryCompletionItem[] => {
  const seen = new Set<string>();
  const result: DslQueryCompletionItem[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.label}:${item.insertText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

export const keywordItems = (
  query: string,
  range: DslQueryTextRange,
  items: Array<{ label: string; insertText: string; detail: string }>,
  kind: DslQueryCompletionKind = "keyword",
): DslQueryCompletionItem[] =>
  rankItems(
    query,
    range,
    items.map((item) => completionItem(range, kind, item.label, item.insertText, item.detail)),
  );

export const tokenRangeAt = (query: string, caret: number): DslQueryTextRange => {
  let start = caret;
  while (start > 0 && !/[\s,();=<>+\-*/%]/.test(query[start - 1]!)) start--;
  const token = query.slice(start, caret);
  const dot = token.lastIndexOf(".");
  if (dot >= 0) start += dot + 1;
  return { start, end: caret };
};

const activeSegmentStart = (line: string): number => {
  let quote: string | null = null;
  let parenDepth = 0;
  let braceDepth = 0;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === "\\" && i + 1 < line.length) {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(") parenDepth++;
    else if (c === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (c === "{") braceDepth++;
    else if (c === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (c === ";" && parenDepth === 0 && braceDepth === 0) start = i + 1;
  }
  return start;
};

export const activeSegmentRangeBeforeCaret = (query: string, caret: number): { text: string; start: number } => {
  const before = query.slice(0, caret);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  const localStart = activeSegmentStart(line);
  return { text: line.slice(localStart), start: lineStart + localStart };
};

export const isInsideSingleQuotedString = (segment: string): boolean => {
  let quote = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!;
    if (c === "\\" && quote) {
      i++;
      continue;
    }
    if (c === "'") quote = !quote;
  }
  return quote;
};

const normalizeClauseSegment = (segment: string): string => segment.trimStart().toLowerCase();

export const clauseKind = (segment: string): string => {
  const lower = normalizeClauseSegment(segment);
  if (!lower) return "";
  if (lower.startsWith("from")) return "from";
  if (lower.startsWith("left join") || lower.startsWith("join")) return "join";
  if (lower.startsWith("select")) return "select";
  if (lower.startsWith("where")) return "where";
  if (lower.startsWith("group by")) return "group";
  if (lower.startsWith("aggregate")) return "aggregate";
  if (lower.startsWith("having")) return "having";
  if (lower.startsWith("sort")) return "sort";
  if (lower.startsWith("search")) return "search";
  if (lower.startsWith("include") || lower.startsWith("deleted")) return "deleted";
  return lower.split(/\s+/, 1)[0] ?? "";
};
