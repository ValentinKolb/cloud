import type { DslQueryCompletionItem, DslQueryCompletionKind, DslQueryTextRange } from "../contracts";
import { formatIdentifierRef, normalizeRefKey, parseIdentifierRef, parseQualifiedIdentifierRef } from "../ref-syntax";
import { type AggregateKind, isFieldAggregatable } from "../service/aggregate-capabilities";
import { isGroupable } from "../service/group-compiler";
import { filterSearchableFields } from "../service/search";
import type { Field } from "../service/types";
import { type DslDerivedViewColumn, type DslResolverContext, type DslViewSource, derivedViewColumns } from "./resolver";

type CompletionPurpose = "output" | "predicate" | "group" | "aggregate" | "search" | "sort" | "join";

type SourceScope = {
  alias?: string;
  tableId: string;
  fields: Field[];
  derivedColumns?: DslDerivedViewColumn[];
};

type JoinScope = {
  alias: string;
  tableId: string;
  fields: Field[];
};

type ResolvedSource = SourceScope & {
  sourceKind: "table" | "view" | "current";
};

type CompletionRequest = {
  query: string;
  caret: number;
  ctx: DslResolverContext;
  currentSource?: { kind: "table"; tableId: string } | { kind: "view"; viewId: string };
};

const TOP_LEVEL_KEYWORDS: Array<{ label: string; insertText: string; detail: string; singleton?: string }> = [
  { label: "from table", insertText: "from table ", detail: "Choose a base table", singleton: "source" },
  { label: "from view", insertText: "from view ", detail: "Use a saved view as source", singleton: "source" },
  { label: "select", insertText: "select ", detail: "Pick output fields" },
  { label: "where", insertText: "where ", detail: "Filter rows", singleton: "where" },
  { label: "join table", insertText: "join table ", detail: "Join through a relation field" },
  { label: "left join table", insertText: "left join table ", detail: "Keep source rows without a match" },
  { label: "group by", insertText: "group by ", detail: "Bucket rows" },
  { label: "aggregate", insertText: "aggregate ", detail: "Calculate grouped values" },
  { label: "having", insertText: "having ", detail: "Filter grouped output", singleton: "having" },
  { label: "sort", insertText: "sort ", detail: "Order rows or groups" },
  { label: "search", insertText: "search ", detail: "Full-text search", singleton: "search" },
  { label: "limit", insertText: "limit ", detail: "Maximum rows", singleton: "limit" },
  { label: "offset", insertText: "offset ", detail: "Skip rows", singleton: "offset" },
  { label: "include deleted", insertText: "include deleted", detail: "Include trashed records", singleton: "deleted" },
  { label: "deleted only", insertText: "deleted only", detail: "Only trashed records", singleton: "deleted" },
];

const SOURCE_KIND_KEYWORDS = [
  { label: "table", insertText: "table ", detail: "Base table" },
  { label: "view", insertText: "view ", detail: "Saved view" },
];

const JOIN_KIND_KEYWORDS = [{ label: "table", insertText: "table ", detail: "Join target table" }];
const SORT_DIRECTIONS = ["asc", "desc"];
const NULL_MODIFIERS = ["nulls first", "nulls last"];
const NULL_PLACEMENTS = ["first", "last"];
const GROUP_GRANULARITIES = ["day", "week", "month", "quarter", "year"];
const AGGREGATE_FUNCTIONS: AggregateKind[] = [
  "count",
  "countEmpty",
  "countUnique",
  "sum",
  "avg",
  "min",
  "max",
  "median",
  "earliest",
  "latest",
];
const PREDICATE_FUNCTIONS = [
  { label: "oneof", insertText: "oneof(", detail: "Membership: field equals one listed value" },
  { label: "noneof", insertText: "noneof(", detail: "Membership: field equals none of the listed values" },
  { label: "containsall", insertText: "containsall(", detail: "Multi-value field contains every listed value" },
  { label: "contains", insertText: "contains(", detail: "Case-sensitive text contains" },
  { label: "startswith", insertText: "startswith(", detail: "Case-sensitive text prefix" },
  { label: "endswith", insertText: "endswith(", detail: "Case-sensitive text suffix" },
  { label: "icontains", insertText: "icontains(", detail: "Case-insensitive text contains" },
  { label: "istartswith", insertText: "istartswith(", detail: "Case-insensitive text prefix" },
  { label: "iendswith", insertText: "iendswith(", detail: "Case-insensitive text suffix" },
];
const PREDICATE_OPERATORS = [
  { label: "and", insertText: "and ", detail: "Boolean AND" },
  { label: "or", insertText: "or ", detail: "Boolean OR" },
  { label: "not", insertText: "not ", detail: "Boolean NOT" },
];
const PREDICATE_COMPARISON_OPERATORS = [
  { label: "=", insertText: "= ", detail: "equals" },
  { label: "!=", insertText: "!= ", detail: "does not equal" },
  { label: ">", insertText: "> ", detail: "greater than" },
  { label: ">=", insertText: ">= ", detail: "greater than or equal" },
  { label: "<", insertText: "< ", detail: "less than" },
  { label: "<=", insertText: "<= ", detail: "less than or equal" },
];
const PREDICATE_JOIN_OPERATORS = PREDICATE_OPERATORS.filter((item) => item.label !== "not");

const SOURCE_REF_RE = String.raw`(?:\{[^}\r\n]+\}|"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_]*|[0-9A-Fa-f-]{8,})`;
const QUALIFIED_REF_RE = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*\.)?${SOURCE_REF_RE}`;
const SEARCH_QUOTED_RE = /^'((?:\\.|[^'\\])*)'/;

const isDiagnostic = (value: unknown): value is { message: string } => typeof value === "object" && value !== null && "message" in value;

const aliveFields = (fields: Field[]): Field[] => fields.filter((field) => !field.deletedAt).sort((a, b) => a.position - b.position);

const rangeText = (query: string, range: DslQueryTextRange): string => query.slice(range.start, range.end);

const tokenNeedle = (query: string, range: DslQueryTextRange): string =>
  rangeText(query, range).replace(/^[{"]/, "").replace(/[}"]$/, "").toLowerCase();

const matchesNeedle = (query: string, range: DslQueryTextRange, values: string[]): boolean => {
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

const rankItems = (query: string, range: DslQueryTextRange, items: DslQueryCompletionItem[]): DslQueryCompletionItem[] => {
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

const completionItem = (
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

const uniqueItems = (items: DslQueryCompletionItem[]): DslQueryCompletionItem[] => {
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

const keywordItems = (
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

const tokenRangeAt = (query: string, caret: number): DslQueryTextRange => {
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

const activeSegmentRangeBeforeCaret = (query: string, caret: number): { text: string; start: number } => {
  const before = query.slice(0, caret);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  const localStart = activeSegmentStart(line);
  return { text: line.slice(localStart), start: lineStart + localStart };
};

const isInsideSingleQuotedString = (segment: string): boolean => {
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

const clauseKind = (segment: string): string => {
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

const usedSingletonClauses = (query: string) => {
  const lower = query.toLowerCase();
  return {
    source: /\bfrom\s+/.test(lower),
    where: /\bwhere\s+/.test(lower),
    having: /\bhaving\s+/.test(lower),
    search: /\bsearch\s+/.test(lower),
    limit: /\blimit\s+/.test(lower),
    offset: /\boffset\s+/.test(lower),
    deleted: /\binclude\s+deleted\b|\bdeleted\s+only\b/.test(lower),
  };
};

const topLevelSuggestions = (query: string, range: DslQueryTextRange): DslQueryCompletionItem[] => {
  const used = usedSingletonClauses(query);
  const items = TOP_LEVEL_KEYWORDS.filter((item) => !item.singleton || !used[item.singleton as keyof typeof used]);
  return keywordItems(query, range, items);
};

const unquoteRef = (raw: string): string | null => parseIdentifierRef(raw.trim());

const sourceMatches = (source: { id: string; shortId: string; name: string }, ref: string): boolean => {
  const key = normalizeRefKey(ref);
  return normalizeRefKey(source.id) === key || normalizeRefKey(source.shortId) === key || normalizeRefKey(source.name) === key;
};

const resolveView = (ctx: DslResolverContext, ref: string): DslViewSource | undefined =>
  (ctx.views ?? []).find((view) => sourceMatches(view, ref));

const viewIsDerived = (view: DslViewSource): boolean => (view.query.groupBy?.length ?? 0) > 0 || (view.query.aggregations?.length ?? 0) > 0;

const derivedColumnsForView = (ctx: DslResolverContext, view: DslViewSource): DslDerivedViewColumn[] | undefined => {
  if (!viewIsDerived(view)) return undefined;
  const columns = derivedViewColumns(view.query, aliveFields(ctx.fieldsByTableId[view.tableId] ?? []));
  return isDiagnostic(columns) ? undefined : columns;
};

const explicitSource = (query: string): { kind: "table" | "view"; ref: string; alias?: string } | undefined => {
  const re = new RegExp(String.raw`\bfrom\s+(table|view)\s+(${SOURCE_REF_RE})(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?`, "gi");
  let found: { kind: "table" | "view"; ref: string; alias?: string } | undefined;
  for (const match of query.matchAll(re)) {
    const ref = match[2] ? unquoteRef(match[2]) : null;
    if (!ref) continue;
    found = {
      kind: match[1]!.toLowerCase() as "table" | "view",
      ref,
      ...(match[3] ? { alias: match[3] } : {}),
    };
  }
  return found;
};

const sourceFromCurrentSource = (
  ctx: DslResolverContext,
  currentSource: CompletionRequest["currentSource"],
): ResolvedSource | undefined => {
  if (currentSource?.kind === "table") {
    const table = ctx.tables.find((item) => item.id === currentSource.tableId);
    if (!table) return undefined;
    return {
      sourceKind: "current",
      tableId: table.id,
      fields: aliveFields(ctx.fieldsByTableId[table.id] ?? []),
    };
  }
  if (currentSource?.kind === "view") {
    const view = (ctx.views ?? []).find((item) => item.id === currentSource.viewId);
    if (!view) return undefined;
    const derivedColumns = derivedColumnsForView(ctx, view);
    return {
      sourceKind: "view",
      tableId: view.tableId,
      fields: aliveFields(ctx.fieldsByTableId[view.tableId] ?? []),
      ...(derivedColumns ? { derivedColumns } : {}),
    };
  }
  return undefined;
};

const resolveSource = (
  ctx: DslResolverContext,
  query: string,
  currentSource: CompletionRequest["currentSource"],
): ResolvedSource | undefined => {
  const from = explicitSource(query);
  if (from?.kind === "table") {
    const table = ctx.tables.find((item) => sourceMatches(item, from.ref));
    if (!table) return undefined;
    return {
      sourceKind: "table",
      tableId: table.id,
      fields: aliveFields(ctx.fieldsByTableId[table.id] ?? []),
      ...(from.alias ? { alias: from.alias } : {}),
    };
  }
  if (from?.kind === "view") {
    const view = resolveView(ctx, from.ref);
    if (!view) return undefined;
    const derivedColumns = derivedColumnsForView(ctx, view);
    return {
      sourceKind: "view",
      tableId: view.tableId,
      fields: aliveFields(ctx.fieldsByTableId[view.tableId] ?? []),
      ...(from.alias ? { alias: from.alias } : {}),
      ...(derivedColumns ? { derivedColumns } : {}),
    };
  }
  const current = sourceFromCurrentSource(ctx, currentSource);
  if (current) return current;
  if (!ctx.currentTable) return undefined;
  return {
    sourceKind: "current",
    tableId: ctx.currentTable.id,
    fields: aliveFields(ctx.fieldsByTableId[ctx.currentTable.id] ?? []),
  };
};

const collectJoinScopes = (ctx: DslResolverContext, query: string): JoinScope[] => {
  const re = new RegExp(String.raw`\b(?:left\s+)?join\s+table\s+(${SOURCE_REF_RE})\s+as\s+([A-Za-z_][A-Za-z0-9_]*)`, "gi");
  const joins: JoinScope[] = [];
  const seen = new Set<string>();
  for (const match of query.matchAll(re)) {
    const ref = match[1] ? unquoteRef(match[1]) : null;
    const alias = match[2];
    if (!ref || !alias) continue;
    const table = ctx.tables.find((item) => sourceMatches(item, ref));
    if (!table) continue;
    const key = normalizeRefKey(alias);
    if (seen.has(key)) continue;
    seen.add(key);
    joins.push({ alias, tableId: table.id, fields: aliveFields(ctx.fieldsByTableId[table.id] ?? []) });
  }
  return joins;
};

const relationTargetReadable = (ctx: DslResolverContext, field: Field): boolean => {
  if (field.type !== "relation") return true;
  const targetTableId = (field.config as { targetTableId?: string }).targetTableId;
  return !targetTableId || ctx.tables.some((table) => table.id === targetTableId);
};

const fieldAllowedForPurpose = (ctx: DslResolverContext, field: Field, purpose: CompletionPurpose, aggregate?: AggregateKind): boolean => {
  if (field.deletedAt) return false;
  if ((purpose === "output" || purpose === "search") && !relationTargetReadable(ctx, field)) return false;
  if (purpose === "group") return isGroupable(field);
  if (purpose === "search") return filterSearchableFields([field]).length > 0;
  if (purpose === "aggregate") return aggregate ? isFieldAggregatable(field, aggregate, false) : true;
  return true;
};

const fieldItem = (range: DslQueryTextRange, field: Field, insertText: string, detailPrefix?: string): DslQueryCompletionItem =>
  completionItem(range, "field", field.name, insertText, `${detailPrefix ? `${detailPrefix} · ` : ""}${field.type} · ${field.shortId}`);

const pseudoIdItem = (range: DslQueryTextRange, insertText: string): DslQueryCompletionItem =>
  completionItem(range, "field", "id", insertText, "record id");

const columnAllowedForPurpose = (column: DslDerivedViewColumn, purpose: CompletionPurpose, aggregate?: AggregateKind): boolean => {
  if (purpose === "search") return column.sqlType !== "json";
  if (purpose === "aggregate") {
    if (!aggregate) return true;
    if (aggregate === "count" || aggregate === "countEmpty" || aggregate === "countUnique") return true;
    if (aggregate === "sum" || aggregate === "avg" || aggregate === "median") return column.sqlType === "numeric";
    if (aggregate === "earliest" || aggregate === "latest") return column.sqlType === "date" || column.sqlType === "datetime";
    return column.sqlType === "numeric" || column.sqlType === "date" || column.sqlType === "datetime" || column.sqlType === "text";
  }
  return column.sqlType !== "json";
};

const derivedColumnItem = (range: DslQueryTextRange, column: DslDerivedViewColumn, insertText?: string): DslQueryCompletionItem =>
  completionItem(range, "column", column.label, insertText ?? formatIdentifierRef(column.label), `${column.kind} · ${column.sqlType}`);

const scopeBeforeToken = (query: string, range: DslQueryTextRange): string | undefined => {
  const before = query.slice(0, range.start);
  const match = before.match(/([A-Za-z_][A-Za-z0-9_]*)\.$/);
  return match?.[1];
};

const fieldReferenceSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  purpose: CompletionPurpose,
  aggregate?: AggregateKind,
  currentSource?: CompletionRequest["currentSource"],
): DslQueryCompletionItem[] => {
  const source = resolveSource(ctx, query, currentSource);
  const joins = collectJoinScopes(ctx, query);
  const scope = scopeBeforeToken(query, range);
  const items: DslQueryCompletionItem[] = [];

  const pushFields = (fields: Field[], prefix?: string) => {
    for (const field of fields) {
      if (!fieldAllowedForPurpose(ctx, field, purpose, aggregate)) continue;
      const ref = formatIdentifierRef(field.name);
      items.push(fieldItem(range, field, prefix ? `${prefix}.${ref}` : ref, prefix));
    }
  };

  if (scope) {
    const join = joins.find((item) => normalizeRefKey(item.alias) === normalizeRefKey(scope));
    if (join) {
      if (purpose === "join") items.push(pseudoIdItem(range, "id"));
      pushFields(join.fields);
      return rankItems(query, range, uniqueItems(items));
    }
    if (source?.alias && normalizeRefKey(source.alias) === normalizeRefKey(scope) && !source.derivedColumns) {
      if (purpose === "join") items.push(pseudoIdItem(range, "id"));
      pushFields(source.fields);
      return rankItems(query, range, uniqueItems(items));
    }
    return [];
  }

  if (purpose === "join") items.push(pseudoIdItem(range, "id"));
  if (source?.derivedColumns) {
    for (const column of source.derivedColumns) {
      if (columnAllowedForPurpose(column, purpose, aggregate)) items.push(derivedColumnItem(range, column));
    }
  } else if (source) {
    pushFields(source.fields);
  }

  for (const join of joins) {
    for (const field of join.fields) {
      if (!fieldAllowedForPurpose(ctx, field, purpose, aggregate)) continue;
      const ref = `${join.alias}.${formatIdentifierRef(field.name)}`;
      items.push(fieldItem(range, field, ref, join.alias));
    }
  }

  return rankItems(query, range, uniqueItems(items));
};

const sourceSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  kind: "table" | "view",
): DslQueryCompletionItem[] => {
  const items =
    kind === "table"
      ? ctx.tables.map((table) =>
          completionItem(range, "source", table.name, formatIdentifierRef(table.name), `table · ${table.shortId}`, [" "]),
        )
      : (ctx.views ?? []).map((view) =>
          completionItem(range, "source", view.name, formatIdentifierRef(view.name), `view · ${view.shortId}`, [" "]),
        );
  return rankItems(query, range, items);
};

const sourceKindSuggestions = (query: string, range: DslQueryTextRange, join = false): DslQueryCompletionItem[] =>
  keywordItems(query, range, join ? JOIN_KIND_KEYWORDS : SOURCE_KIND_KEYWORDS);

const sourceRefExists = (ctx: DslResolverContext, kind: "table" | "view", ref: string): boolean =>
  kind === "table" ? ctx.tables.some((table) => sourceMatches(table, ref)) : (ctx.views ?? []).some((view) => sourceMatches(view, ref));

const defaultAliasForRef = (ref: string): string => {
  const alias = normalizeRefKey(ref)
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!alias) return "joined";
  return /^[a-z_]/.test(alias) ? alias : `joined_${alias}`;
};

const defaultAggregateAlias = (fn: string, arg: string): string => {
  if (arg.trim() === "*") return `${fn.toLowerCase()}_rows`;
  return `${fn.toLowerCase()}_${defaultAliasForRef(arg)}`;
};

const completedQualifiedRef = (input: string): { ref: string; tail: string } | null => {
  const match = input.match(new RegExp(String.raw`^\s*(${QUALIFIED_REF_RE})([\s\S]*)$`, "i"));
  const ref = match?.[1];
  if (!ref || !parseQualifiedIdentifierRef(ref)) return null;
  return { ref, tail: match[2] ?? "" };
};

const splitJoinEquality = (input: string): { left: string; right: string } | null => {
  let quote: string | null = null;
  let braceDepth = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote) {
      if (quote === `"` && c === `"` && input[i + 1] === `"`) {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === `"` || c === "'") {
      quote = c;
      continue;
    }
    if (c === "{") {
      braceDepth++;
      continue;
    }
    if (c === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (braceDepth === 0 && c === "=") return { left: input.slice(0, i), right: input.slice(i + 1) };
  }
  return null;
};

const containsComparisonOperator = (input: string): boolean => {
  let quote: string | null = null;
  let braceDepth = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote) {
      if (quote === `"` && c === `"` && input[i + 1] === `"`) {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === `"` || c === "'") {
      quote = c;
      continue;
    }
    if (c === "{") {
      braceDepth++;
      continue;
    }
    if (c === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (braceDepth === 0 && /[=<>!]/.test(c)) return true;
  }
  return false;
};

const groupRefSupportsGranularity = (
  ctx: DslResolverContext,
  query: string,
  rawRef: string,
  currentSource?: CompletionRequest["currentSource"],
): boolean => {
  const parsed = parseQualifiedIdentifierRef(rawRef.trim());
  if (!parsed) return false;

  const source = resolveSource(ctx, query, currentSource);
  const joins = collectJoinScopes(ctx, query);
  const isDateLike = (type: string | undefined, sqlType?: string) =>
    type === "date" || type === "datetime" || sqlType === "date" || sqlType === "datetime";

  if (parsed.scope) {
    const join = joins.find((item) => normalizeRefKey(item.alias) === normalizeRefKey(parsed.scope!));
    if (join) return isDateLike(join.fields.find((field) => sourceMatches(field, parsed.ref))?.type);
    if (source?.alias && normalizeRefKey(source.alias) === normalizeRefKey(parsed.scope) && !source.derivedColumns) {
      return isDateLike(source.fields.find((field) => sourceMatches(field, parsed.ref))?.type);
    }
    return false;
  }

  if (source?.derivedColumns) {
    const column = source.derivedColumns.find((item) =>
      [item.key, item.label, ...item.refs].some((ref) => normalizeRefKey(ref) === normalizeRefKey(parsed.ref)),
    );
    return isDateLike(column?.type, column?.sqlType);
  }
  return isDateLike(source?.fields.find((field) => sourceMatches(field, parsed.ref))?.type);
};

const completedFromSource = (
  ctx: DslResolverContext,
  segment: string,
): { kind: "table" | "view"; ref: string; tail: string; tailStart: number } | null => {
  const leading = segment.match(/^\s*/)?.[0].length ?? 0;
  const sourceMatch = segment
    .slice(leading)
    .match(new RegExp(String.raw`^from\s+(table|view)\s+(${SOURCE_REF_RE})(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?`, "i"));
  if (!sourceMatch) return null;
  const kind = sourceMatch[1]!.toLowerCase() as "table" | "view";
  const ref = sourceMatch[2] ? unquoteRef(sourceMatch[2]) : null;
  if (!ref || !sourceRefExists(ctx, kind, ref)) return null;
  const tailStart = leading + sourceMatch[0].length;
  return { kind, ref, tail: segment.slice(tailStart), tailStart };
};

const SAME_LINE_CLAUSE_KEYWORDS = [
  { clause: "select", re: /^select\b/i },
  { clause: "where", re: /^where\b/i },
  { clause: "left join", re: /^left\s+join\b/i },
  { clause: "join", re: /^join\b/i },
  { clause: "group by", re: /^group\s+by\b/i },
  { clause: "aggregate", re: /^aggregate\b/i },
  { clause: "having", re: /^having\b/i },
  { clause: "sort", re: /^sort\b/i },
  { clause: "search", re: /^search\b/i },
  { clause: "limit", re: /^limit\b/i },
  { clause: "offset", re: /^offset\b/i },
  { clause: "include deleted", re: /^include\s+deleted\b/i },
  { clause: "deleted only", re: /^deleted\s+only\b/i },
] as const;

const sameLineClauseSegment = (
  segment: string,
  absoluteSegmentStart: number,
  source: NonNullable<ReturnType<typeof completedFromSource>>,
): { segment: string; absoluteStart: number } | null => {
  const firstNonSpace = source.tail.search(/\S/);
  if (firstNonSpace < 0) return null;
  const trimmedTail = source.tail.slice(firstNonSpace);
  const keyword = SAME_LINE_CLAUSE_KEYWORDS.find((item) => item.re.test(trimmedTail));
  if (!keyword) return null;
  const absoluteStart = absoluteSegmentStart + source.tailStart + firstNonSpace;
  return { segment: segment.slice(source.tailStart + firstNonSpace), absoluteStart };
};

const newlinePrefixedItems = (items: DslQueryCompletionItem[]): DslQueryCompletionItem[] =>
  items.map((item) => ({
    ...item,
    insertText: `\n${item.insertText}`,
    textEdit: { ...item.textEdit, text: `\n${item.textEdit.text}` },
  }));

const rewriteSameLineClauseItems = (query: string, items: DslQueryCompletionItem[], clauseStart: number): DslQueryCompletionItem[] =>
  items.map((item) => ({
    ...item,
    textEdit: {
      start: clauseStart,
      end: item.textEdit.end,
      text: `\n${query.slice(clauseStart, item.textEdit.start)}${item.textEdit.text}`,
    },
  }));

const sourceClauseSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  segment: string,
): DslQueryCompletionItem[] => {
  const completed = completedFromSource(ctx, segment);
  if (completed && /^\s+a?s?$/i.test(completed.tail)) {
    return keywordItems(query, range, [{ label: "as", insertText: "as ", detail: "Name this source scope" }]);
  }
  if (completed && /^\s+as\s*$/i.test(completed.tail)) {
    const alias = defaultAliasForRef(completed.ref);
    return keywordItems(query, range, [{ label: alias, insertText: alias, detail: "Source alias" }], "alias");
  }
  if (completed?.tail === "") {
    return keywordItems(query, { start: range.end, end: range.end }, [
      { label: "as", insertText: " as ", detail: "Name this source scope" },
    ]);
  }
  if (completed?.tail.trim().length === 0 && /\s$/.test(completed.tail)) return newlinePrefixedItems(topLevelSuggestions(query, range));
  if (completed && completed.tail.trim().length > 0 && !sameLineClauseSegment(segment, 0, completed)) {
    return newlinePrefixedItems(topLevelSuggestions(query, range));
  }

  const restRaw = segment.trimStart().replace(/^from\b/i, "");
  const rest = restRaw.trimStart();
  if (!rest || /^(?:t|ta|tab|tabl|v|vi|vie)$/i.test(rest)) return sourceKindSuggestions(query, range);
  const kindMatch = rest.match(/^(table|view)(?:\s+([\s\S]*))?$/i);
  if (!kindMatch) return [];
  if (kindMatch[2] === undefined && !/\s$/.test(restRaw)) return sourceKindSuggestions(query, range);
  return sourceSuggestions(ctx, query, range, kindMatch[1]!.toLowerCase() as "table" | "view");
};

const joinClauseSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  segment: string,
  currentSource?: CompletionRequest["currentSource"],
): DslQueryCompletionItem[] => {
  const restRaw = segment.trimStart().replace(/^(?:left\s+)?join\b/i, "");
  const rest = restRaw.trimStart();
  if (!rest || /^(?:t|ta|tab|tabl)$/i.test(rest)) return sourceKindSuggestions(query, range, true);
  const tableMatch = rest.match(/^table\b([\s\S]*)$/i);
  if (!tableMatch) return [];
  const afterTable = tableMatch[1] ?? "";
  if (!afterTable && !/\s$/.test(restRaw)) return sourceKindSuggestions(query, range, true);

  const sourceMatch = afterTable.match(new RegExp(String.raw`^\s+(${SOURCE_REF_RE})([\s\S]*)$`, "i"));
  if (!sourceMatch) return sourceSuggestions(ctx, query, range, "table");

  const sourceRef = sourceMatch[1] ? unquoteRef(sourceMatch[1]) : null;
  if (!sourceRef || !sourceRefExists(ctx, "table", sourceRef)) return sourceSuggestions(ctx, query, range, "table");

  const tail = sourceMatch[2] ?? "";
  if (tail === "") {
    return keywordItems(query, { start: range.end, end: range.end }, [{ label: "as", insertText: " as ", detail: "Name this join scope" }]);
  }
  const onMatch = tail.match(/\s+on\b([\s\S]*)$/i);
  if (onMatch) {
    const condition = onMatch[1] ?? "";
    if (condition.trim() === "") return fieldReferenceSuggestions(ctx, query, range, "join", undefined, currentSource);

    const equality = splitJoinEquality(condition);
    if (!equality) {
      const left = completedQualifiedRef(condition);
      if (left && left.tail.trim() === "" && /\s$/.test(condition)) {
        return keywordItems(query, range, [{ label: "=", insertText: "= ", detail: "Join equality" }], "modifier");
      }
      return fieldReferenceSuggestions(ctx, query, range, "join", undefined, currentSource);
    }

    if (equality.right.trim() === "") return fieldReferenceSuggestions(ctx, query, range, "join", undefined, currentSource);
    const right = completedQualifiedRef(equality.right);
    if (right && right.tail.trim() === "" && /\s$/.test(equality.right)) {
      return newlinePrefixedItems(topLevelSuggestions(query, range));
    }
    if (right && right.tail.trim().length > 0) return newlinePrefixedItems(topLevelSuggestions(query, range));
    return fieldReferenceSuggestions(ctx, query, range, "join", undefined, currentSource);
  }
  if (/\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s+\w*$/i.test(tail)) {
    return keywordItems(query, range, [{ label: "on", insertText: "on ", detail: "Join condition" }]);
  }
  if (/\s+as\s*$/i.test(tail)) {
    const alias = defaultAliasForRef(sourceRef);
    return keywordItems(query, range, [{ label: alias, insertText: alias, detail: "Join alias" }], "alias");
  }
  if (/^\s+a?s?$/i.test(tail)) {
    return keywordItems(query, range, [{ label: "as", insertText: "as ", detail: "Name this join scope" }]);
  }
  return [];
};

const aggregateFromFunction = (fn: string): AggregateKind | undefined => {
  const match = AGGREGATE_FUNCTIONS.find((item) => item.toLowerCase() === fn.toLowerCase());
  return match;
};

const aggregateClauseSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  segment: string,
  currentSource?: CompletionRequest["currentSource"],
): DslQueryCompletionItem[] => {
  const body = segment.trimStart().replace(/^aggregate\b/i, "");
  const completedCall = body.match(/([A-Za-z][A-Za-z0-9_]*)\(([^()]*)\)([\s\S]*)$/);
  if (completedCall?.[1] && aggregateFromFunction(completedCall[1])) {
    const fn = completedCall[1];
    const arg = completedCall[2] ?? "";
    const tail = completedCall[3] ?? "";
    if (/^\s+a?s?$/i.test(tail)) return keywordItems(query, range, [{ label: "as", insertText: "as ", detail: "Name this aggregate" }]);
    if (/^\s+as\s*$/i.test(tail)) {
      const alias = defaultAggregateAlias(fn, arg);
      return keywordItems(query, range, [{ label: alias, insertText: alias, detail: "Aggregate alias" }], "alias");
    }
    if (/^\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s*$/i.test(tail)) {
      if (/\s$/.test(tail)) return newlinePrefixedItems(topLevelSuggestions(query, range));
      return [];
    }
    if (/^\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s+\S/i.test(tail)) return newlinePrefixedItems(topLevelSuggestions(query, range));
  }
  const call = body.match(/([A-Za-z][A-Za-z0-9_]*)\([^()]*$/);
  if (call?.[1]) {
    const aggregate = aggregateFromFunction(call[1]);
    const items: DslQueryCompletionItem[] = [];
    if (aggregate === "count" && matchesNeedle(query, range, ["*"])) {
      items.push(completionItem(range, "literal", "*", "*", "all records"));
    }
    items.push(...fieldReferenceSuggestions(ctx, query, range, "aggregate", aggregate, currentSource));
    return rankItems(query, range, uniqueItems(items));
  }
  return keywordItems(
    query,
    range,
    AGGREGATE_FUNCTIONS.map((fn) => ({ label: fn, insertText: `${fn}(`, detail: "aggregate function" })),
    "function",
  );
};

const selectClauseSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  segment: string,
  currentSource?: CompletionRequest["currentSource"],
): DslQueryCompletionItem[] => {
  const body = segment.trimStart().replace(/^select\b/i, "");
  const part = body.slice(body.lastIndexOf(",") + 1);
  if (scopeBeforeToken(query, range)) return fieldReferenceSuggestions(ctx, query, range, "output", undefined, currentSource);
  if (part.trim() === "") return fieldReferenceSuggestions(ctx, query, range, "output", undefined, currentSource);

  const formulaMatch = part.match(/^\s*formula\([\s\S]*\)([\s\S]*)$/i);
  if (formulaMatch) {
    const tail = formulaMatch[1] ?? "";
    if (/^\s+a?s?$/i.test(tail))
      return keywordItems(query, range, [{ label: "as", insertText: "as ", detail: "Name this formula output" }]);
    if (/^\s+as\s*$/i.test(tail)) {
      return keywordItems(query, range, [{ label: "formula_result", insertText: "formula_result", detail: "Select alias" }], "alias");
    }
    if (/^\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s*$/i.test(tail)) {
      if (/\s$/.test(tail)) return newlinePrefixedItems(topLevelSuggestions(query, range));
      return [];
    }
    if (/^\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s+\S/i.test(tail)) return newlinePrefixedItems(topLevelSuggestions(query, range));
    return [];
  }

  const completed = completedQualifiedRef(part);
  if (completed) {
    if (completed.tail === "") return fieldReferenceSuggestions(ctx, query, range, "output", undefined, currentSource);
    if (/^\s+a?s?$/i.test(completed.tail))
      return keywordItems(query, range, [{ label: "as", insertText: "as ", detail: "Name this output" }]);
    if (/^\s+as\s*$/i.test(completed.tail)) {
      return keywordItems(
        query,
        range,
        [{ label: defaultAliasForRef(completed.ref), insertText: defaultAliasForRef(completed.ref), detail: "Select alias" }],
        "alias",
      );
    }
    if (/^\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s*$/i.test(completed.tail)) {
      if (/\s$/.test(completed.tail)) return newlinePrefixedItems(topLevelSuggestions(query, range));
      return [];
    }
    if (/^\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s+\S/i.test(completed.tail)) return newlinePrefixedItems(topLevelSuggestions(query, range));
    return newlinePrefixedItems(topLevelSuggestions(query, range));
  }

  return fieldReferenceSuggestions(ctx, query, range, "output", undefined, currentSource);
};

const aliasSuggestions = (query: string, range: DslQueryTextRange, clause: "select" | "aggregate"): DslQueryCompletionItem[] => {
  const re = new RegExp(String.raw`\b${clause}\s+([^\n;]+)`, "gi");
  const aliases: DslQueryCompletionItem[] = [];
  for (const match of query.matchAll(re)) {
    const body = match[1] ?? "";
    for (const alias of body.matchAll(/\bas\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
      aliases.push(completionItem(range, "alias", alias[1]!, alias[1]!, `${clause} alias`));
    }
  }
  return aliases;
};

const sortTargetSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  currentSource?: CompletionRequest["currentSource"],
): DslQueryCompletionItem[] => {
  const aliases = [...aliasSuggestions(query, range, "select"), ...aliasSuggestions(query, range, "aggregate")];
  return rankItems(
    query,
    range,
    uniqueItems([...fieldReferenceSuggestions(ctx, query, range, "sort", undefined, currentSource), ...aliases]),
  );
};

const sortClauseSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  segment: string,
  currentSource?: CompletionRequest["currentSource"],
): DslQueryCompletionItem[] => {
  const body = segment.trimStart().replace(/^sort\b/i, "");
  const item = body.slice(body.lastIndexOf(",") + 1);
  if (/\bnulls\s+(?:first|last)\s+\S*$/i.test(item) || (/\bnulls\s+(?:first|last)\s*$/i.test(item) && /\s$/.test(item))) {
    return newlinePrefixedItems(topLevelSuggestions(query, range));
  }
  if (/\bnulls\s+\w*$/i.test(item)) {
    return keywordItems(
      query,
      range,
      NULL_PLACEMENTS.map((label) => ({ label, insertText: label, detail: "null ordering" })),
      "modifier",
    );
  }
  if (/\b(?:asc|desc)\s+\w*$/i.test(item)) {
    return keywordItems(
      query,
      range,
      NULL_MODIFIERS.map((label) => ({ label, insertText: label, detail: "null ordering" })),
      "modifier",
    );
  }
  if (/\S+\s+[A-Za-z_]*$/i.test(item) && !scopeBeforeToken(query, range)) {
    return keywordItems(
      query,
      range,
      SORT_DIRECTIONS.map((label) => ({ label, insertText: label, detail: "sort direction" })),
      "modifier",
    );
  }
  return sortTargetSuggestions(ctx, query, range, currentSource);
};

const numericClauseSuggestions = (
  query: string,
  range: DslQueryTextRange,
  segment: string,
  clause: "limit" | "offset",
): DslQueryCompletionItem[] => {
  const body = segment.trimStart().replace(new RegExp(String.raw`^${clause}\b`, "i"), "");
  if (/^\s*\d+\s+\S*$/i.test(body) || (/^\s*\d+\s*$/i.test(body) && /\s$/.test(body))) {
    return newlinePrefixedItems(topLevelSuggestions(query, range));
  }
  return [];
};

const deletedClauseSuggestions = (query: string, range: DslQueryTextRange, segment: string): DslQueryCompletionItem[] => {
  const lower = segment.trimStart().toLowerCase();
  if (/^include\s+\w*$/i.test(lower)) {
    return keywordItems(query, range, [{ label: "deleted", insertText: "deleted", detail: "Include trashed records" }], "modifier");
  }
  if (/^deleted\s+\w*$/i.test(lower)) {
    return keywordItems(query, range, [{ label: "only", insertText: "only", detail: "Only trashed records" }], "modifier");
  }
  if (
    /^(?:include\s+deleted|deleted\s+only)\s+\S*$/i.test(segment) ||
    (/^(?:include\s+deleted|deleted\s+only)\s*$/i.test(segment) && /\s$/.test(segment))
  ) {
    return newlinePrefixedItems(topLevelSuggestions(query, range));
  }
  return [];
};

const groupClauseSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  segment: string,
  currentSource?: CompletionRequest["currentSource"],
): DslQueryCompletionItem[] => {
  const body = segment.trimStart().replace(/^group\s+by\b/i, "");
  const item = body.slice(body.lastIndexOf(",") + 1);
  if (/\s+by\s+\w*$/i.test(item)) {
    return keywordItems(
      query,
      range,
      GROUP_GRANULARITIES.map((label) => ({ label, insertText: label, detail: "date bucket" })),
      "modifier",
    );
  }
  const completed = completedQualifiedRef(item);
  if (completed && completed.tail !== "") {
    if (/^\s+b?y?$/i.test(completed.tail) && groupRefSupportsGranularity(ctx, query, completed.ref, currentSource)) {
      return keywordItems(query, range, [{ label: "by", insertText: "by ", detail: "Date granularity" }]);
    }
    return newlinePrefixedItems(topLevelSuggestions(query, range));
  }
  if (/\s$/.test(item) && groupRefSupportsGranularity(ctx, query, item.trim(), currentSource)) {
    return keywordItems(query, range, [{ label: "by", insertText: "by ", detail: "Date granularity" }]);
  }
  return fieldReferenceSuggestions(ctx, query, range, "group", undefined, currentSource);
};

const predicateSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  segment: string,
  includeAggregateAliases = false,
  currentSource?: CompletionRequest["currentSource"],
): DslQueryCompletionItem[] => {
  const body = segment.trimStart().replace(/^(?:where|having)\b/i, "");
  const trimmedBody = body.trimEnd();
  const expectsOperand =
    trimmedBody.length === 0 ||
    /(?:^|\s)(?:and|or|not)\s*$/i.test(trimmedBody) ||
    /(?:=|!=|>=|<=|>|<|\(|,)\s*$/.test(trimmedBody) ||
    !/\s$/.test(body);
  if (!expectsOperand) {
    const operators = containsComparisonOperator(trimmedBody)
      ? PREDICATE_JOIN_OPERATORS
      : [...PREDICATE_COMPARISON_OPERATORS, ...PREDICATE_JOIN_OPERATORS];
    return keywordItems(query, range, operators, "modifier");
  }

  const items = [
    ...fieldReferenceSuggestions(ctx, query, range, "predicate", undefined, currentSource),
    ...keywordItems(query, range, PREDICATE_FUNCTIONS, "function"),
    ...keywordItems(query, range, PREDICATE_OPERATORS),
  ];
  if (includeAggregateAliases) items.push(...aliasSuggestions(query, range, "aggregate"));
  return rankItems(query, range, uniqueItems(items));
};

const searchClauseSuggestions = (
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  segment: string,
  currentSource?: CompletionRequest["currentSource"],
): DslQueryCompletionItem[] => {
  const body = segment.trimStart().replace(/^search\b/i, "");
  const quoted = body.trimStart().match(SEARCH_QUOTED_RE);
  if (quoted) {
    const rest = body.trimStart().slice(quoted[0].length);
    if (/^\s+i?n?$/i.test(rest)) return keywordItems(query, range, [{ label: "in", insertText: "in ", detail: "Search specific fields" }]);
    if (/^\s+in\s+[\s\S]*$/i.test(rest)) {
      const fieldList = rest.replace(/^\s+in\b/i, "");
      const part = fieldList.slice(fieldList.lastIndexOf(",") + 1);
      const completed = completedQualifiedRef(part);
      if (completed && completed.tail.trim().length > 0) return newlinePrefixedItems(topLevelSuggestions(query, range));
      return fieldReferenceSuggestions(ctx, query, range, "search", undefined, currentSource);
    }
    return [];
  }
  if (matchesNeedle(query, range, ["'text'"])) return [completionItem(range, "literal", "quoted search text", "''", "search text")];
  return [];
};

const clauseSuggestions = (
  kind: string,
  ctx: DslResolverContext,
  query: string,
  range: DslQueryTextRange,
  segment: string,
  currentSource?: CompletionRequest["currentSource"],
): DslQueryCompletionItem[] => {
  switch (kind) {
    case "":
      return topLevelSuggestions(query, range);
    case "from":
      return sourceClauseSuggestions(ctx, query, range, segment);
    case "join":
      return joinClauseSuggestions(ctx, query, range, segment, currentSource);
    case "select":
      return selectClauseSuggestions(ctx, query, range, segment, currentSource);
    case "where":
      return predicateSuggestions(ctx, query, range, segment, false, currentSource);
    case "group":
      return groupClauseSuggestions(ctx, query, range, segment, currentSource);
    case "aggregate":
      return aggregateClauseSuggestions(ctx, query, range, segment, currentSource);
    case "having":
      return predicateSuggestions(ctx, query, range, segment, true, currentSource);
    case "sort":
      return sortClauseSuggestions(ctx, query, range, segment, currentSource);
    case "search":
      return searchClauseSuggestions(ctx, query, range, segment, currentSource);
    case "limit":
      return numericClauseSuggestions(query, range, segment, "limit");
    case "offset":
      return numericClauseSuggestions(query, range, segment, "offset");
    case "deleted":
      return deletedClauseSuggestions(query, range, segment);
    default:
      return topLevelSuggestions(query, range);
  }
};

export const buildDslQueryIntelligence = ({ query, caret, ctx, currentSource }: CompletionRequest): DslQueryCompletionItem[] => {
  const safeCaret = Math.max(0, Math.min(caret, query.length));
  const range = tokenRangeAt(query, safeCaret);
  const active = activeSegmentRangeBeforeCaret(query, safeCaret);
  const segment = active.text;
  if (isInsideSingleQuotedString(segment)) return [];

  const completed = completedFromSource(ctx, segment);
  const sameLine = completed ? sameLineClauseSegment(segment, active.start, completed) : null;
  if (sameLine) {
    const items = clauseSuggestions(clauseKind(sameLine.segment), ctx, query, range, sameLine.segment, currentSource);
    return rewriteSameLineClauseItems(query, items, sameLine.absoluteStart);
  }

  return clauseSuggestions(clauseKind(segment), ctx, query, range, segment, currentSource);
};
