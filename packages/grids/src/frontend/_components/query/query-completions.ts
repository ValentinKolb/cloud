import type { Completion, SuggestContext, Suggestion } from "@valentinkolb/cloud/ui";
import { formatIdentifierRef, normalizeRefKey, parseIdentifierRef } from "../../../ref-syntax";
import type { Field, Table, View } from "../../../service";
import { formulaFieldRefs, formulaValueSuggestions } from "../fields/formula-authoring";

type CurrentSource =
  | { kind: "table"; tableId: string; label: string; ref: string }
  | { kind: "view"; viewId: string; label: string; ref: string }
  | undefined;

type QueryCompletionContext = {
  currentSource?: CurrentSource;
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
};

const KEYWORDS: Suggestion[] = [
  { text: "from table ", label: "from table", hint: "Choose a base table", appendSpace: false },
  { text: "from view ", label: "from view", hint: "Use a saved view as source", appendSpace: false },
  { text: "select ", label: "select", hint: "Pick output fields", appendSpace: false },
  { text: "where ", label: "where", hint: "Filter rows", appendSpace: false },
  { text: "join table ", label: "join table", hint: "Inner join on a relation", appendSpace: false },
  { text: "left join table ", label: "left join table", hint: "Keep rows without a match", appendSpace: false },
  { text: "group by ", label: "group by", hint: "Bucket records", appendSpace: false },
  { text: "aggregate ", label: "aggregate", hint: "Calculate grouped values" },
  { text: "having ", label: "having", hint: "Filter grouped output", appendSpace: false },
  { text: "sort ", label: "sort", hint: "Order rows or groups" },
  { text: "search ", label: "search", hint: "Full-text search", appendSpace: false },
  { text: "limit ", label: "limit", hint: "Maximum rows" },
  { text: "offset ", label: "offset", hint: "Offset rows" },
  { text: "include deleted", label: "include deleted", hint: "Include trashed records" },
  { text: "deleted only", label: "deleted only", hint: "Only trashed records" },
];

const CLAUSE_KEYWORDS = new Set([
  "from",
  "select",
  "where",
  "join",
  "left",
  "group",
  "aggregate",
  "having",
  "sort",
  "search",
  "limit",
  "offset",
  "include",
  "deleted",
  "nulls",
]);

const AGGREGATE_FUNCTIONS = ["count", "countEmpty", "countUnique", "sum", "avg", "min", "max", "median", "earliest", "latest"];
const GROUP_GRANULARITIES = ["day", "week", "month", "quarter", "year"];
const GQL_REMOVED_FORMULA_FUNCTIONS = new Set(["AND", "OR", "NOT"]);

const lower = (value: string) => value.toLowerCase();
const sourceNeedle = (label: string, ref: string, kind: string) => `${label} ${ref} ${kind}`.toLowerCase();

const matches = (needle: string, query: string) => {
  const q = query.trim().toLowerCase();
  return !q || needle.includes(q);
};

const lineBeforeCaret = (ctx: SuggestContext) => {
  const before = ctx.fullText.slice(0, ctx.caret);
  return before.slice(before.lastIndexOf("\n") + 1);
};

const activeClauseSegment = (line: string): string => {
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
    if (c === "(") {
      parenDepth++;
      continue;
    }
    if (c === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
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
    if (parenDepth === 0 && braceDepth === 0 && c === ";") start = i + 1;
  }

  return line.slice(start);
};

const clauseForLine = (line: string): string => {
  const trimmed = activeClauseSegment(line).trimStart().toLowerCase();
  if (trimmed.startsWith("from ")) return "from";
  if (trimmed.startsWith("left join ")) return "join";
  if (trimmed.startsWith("join ")) return "join";
  if (trimmed.startsWith("where ")) return "where";
  if (trimmed.startsWith("group by ")) return "group";
  if (trimmed.startsWith("having ")) return "having";
  if (trimmed.startsWith("search ")) return "search";
  if (trimmed.startsWith("include deleted")) return "include";
  if (trimmed.startsWith("deleted only")) return "deleted";
  return trimmed.split(/\s+/, 1)[0] ?? "";
};

const nextClausePrefix = (line: string): string => (activeClauseSegment(line).trim().length > 0 ? "\n" : " ");

const sourcePositionKind = (line: string, keyword: "from" | "join", allowView = true): "table" | "view" | undefined | null => {
  const activeLine = activeClauseSegment(line);
  const right = activeLine.trimEnd();
  const hadTrailingWhitespace = right.length !== activeLine.length;
  const sourceKinds = allowView ? "table|view" : "table";
  const typed = right.match(new RegExp(`\\b${keyword}\\s+(${sourceKinds})(?:\\s+("[^"]*"?|[A-Za-z_][A-Za-z0-9_]*))?$`, "i"));
  if (typed) {
    const ref = typed[2] ?? "";
    if (hadTrailingWhitespace && ref) return null;
    return typed[1]?.toLowerCase() as "table" | "view";
  }

  const untyped = right.match(new RegExp(`\\b${keyword}\\s+("[^"]*"?|[A-Za-z_][A-Za-z0-9_]*)$`, "i"));
  if (untyped) {
    const ref = untyped[1] ?? "";
    if (hadTrailingWhitespace && ref) return null;
    return undefined;
  }

  return null;
};

const fromSourcePositionKind = (ctx: SuggestContext) => sourcePositionKind(lineBeforeCaret(ctx), "from");
const joinSourcePositionKind = (ctx: SuggestContext) => sourcePositionKind(lineBeforeCaret(ctx), "join", false);

const isPredicateClausePosition = (ctx: SuggestContext) => {
  const clause = clauseForLine(lineBeforeCaret(ctx));
  return clause === "where" || clause === "having";
};

const isFormulaPosition = (ctx: SuggestContext) => {
  const line = lineBeforeCaret(ctx).toLowerCase();
  return isPredicateClausePosition(ctx) || /\bformula\([\s\S]*$/i.test(line);
};

const tableByRef = (tables: Table[]) =>
  new Map(
    tables.flatMap((table) => [
      [normalizeRefKey(table.shortId), table],
      [normalizeRefKey(table.name), table],
    ]),
  );
const viewByRef = (views: View[]) =>
  new Map(
    views.flatMap((view) => [
      [normalizeRefKey(view.shortId), view],
      [normalizeRefKey(view.name), view],
    ]),
  );

const sourceTable = (ctx: QueryCompletionContext, fullText: string): Table | undefined => {
  const currentSource = ctx.currentSource;
  if (currentSource?.kind === "table") return ctx.tables.find((table) => table.id === currentSource.tableId);
  if (currentSource?.kind === "view") {
    const view = viewSources(ctx).find((item) => item.id === currentSource.viewId);
    return view ? ctx.tables.find((table) => table.id === view.tableId) : ctx.tables[0];
  }
  const match = fullText.match(/\bfrom\s+(?:(?:table|view)\s+)?(?<ref>"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/i);
  const ref = match?.groups?.ref ? parseIdentifierRef(match.groups.ref) : null;
  if (!ref) return ctx.tables[0];
  const table = tableByRef(ctx.tables).get(normalizeRefKey(ref));
  if (table) return table;
  const view = viewByRef(viewSources(ctx)).get(normalizeRefKey(ref));
  return view ? ctx.tables.find((item) => item.id === view.tableId) : ctx.tables[0];
};

const sourceFields = (ctx: QueryCompletionContext, fullText: string): Field[] => {
  const table = sourceTable(ctx, fullText);
  return table ? (ctx.fieldsByTable[table.id] ?? []).filter((field) => !field.deletedAt) : [];
};

const viewSources = (ctx: QueryCompletionContext): View[] =>
  Object.values(ctx.viewsByTable)
    .flat()
    .filter((view) => !view.deletedAt);

const sourceSuggestions = (ctx: QueryCompletionContext, query: string, kind?: "table" | "view"): Suggestion[] => {
  const tables =
    kind === "view"
      ? []
      : ctx.tables
          .filter((table) => matches(sourceNeedle(table.name, table.shortId, "table"), query))
          .map((table) => ({
            text: table.name,
            expansion: formatIdentifierRef(table.name),
            label: table.name,
            hint: `table · ${formatIdentifierRef(table.name)}`,
            appendSpace: false,
          }));
  const views =
    kind === "table"
      ? []
      : viewSources(ctx)
          .filter((view) => matches(sourceNeedle(view.name, view.shortId, "view"), query))
          .map((view) => ({
            text: view.name,
            expansion: formatIdentifierRef(view.name),
            label: view.name,
            hint: `view · ${formatIdentifierRef(view.name)}`,
            appendSpace: false,
          }));
  return [...tables, ...views].slice(0, 40);
};

const fieldSuggestions = (ctx: QueryCompletionContext, query: string, suggestCtx: SuggestContext): Suggestion[] =>
  sourceFields(ctx, suggestCtx.fullText)
    .filter((field) => matches(`${field.name} ${field.shortId} ${field.type}`.toLowerCase(), query))
    .map((field) => ({
      text: field.name,
      expansion: formatIdentifierRef(field.name),
      label: field.name,
      hint: `${field.type} · ${formatIdentifierRef(field.name)}`,
    }))
    .slice(0, 40);

const usedSingletonClauses = (fullText: string) => {
  const lower = fullText.toLowerCase();
  return {
    source: /\bfrom\s+/.test(lower),
    where: /\bwhere\s+/.test(lower),
    having: /\bhaving\s+/.test(lower),
    search: /\bsearch\s+/.test(lower),
    limit: /\blimit\s+/.test(lower),
    offset: /\boffset\s+/.test(lower),
    includeDeleted: /\binclude\s+deleted\b/.test(lower),
    deletedOnly: /\bdeleted\s+only\b/.test(lower),
  };
};

const keywordSuggestions = (query: string, suggestCtx?: SuggestContext): Suggestion[] => {
  const q = query.trim().toLowerCase();
  const used = suggestCtx ? usedSingletonClauses(suggestCtx.fullText) : null;
  return KEYWORDS.filter((item) => {
    const text = item.text.toLowerCase();
    if (used?.source && (text.startsWith("from table") || text.startsWith("from view"))) return false;
    if (used?.where && text.startsWith("where")) return false;
    if (used?.having && text.startsWith("having")) return false;
    if (used?.search && text.startsWith("search")) return false;
    if (used?.limit && text.startsWith("limit")) return false;
    if (used?.offset && text.startsWith("offset")) return false;
    if ((used?.includeDeleted || used?.deletedOnly) && (text.startsWith("include deleted") || text.startsWith("deleted only")))
      return false;
    return !q || text.startsWith(q) || item.label?.toLowerCase().startsWith(q);
  }).slice(0, 20);
};

const aggregateSuggestions = (query: string): Suggestion[] =>
  AGGREGATE_FUNCTIONS.filter((fn) => fn.toLowerCase().startsWith(query.trim().toLowerCase())).map((fn) => ({
    text: `${fn}(`,
    label: `${fn}(...)`,
    hint: "aggregate",
  }));

const granularitySuggestions = (query: string): Suggestion[] =>
  GROUP_GRANULARITIES.filter((item) => item.startsWith(query.trim().toLowerCase())).map((item) => ({
    text: item,
    hint: "date grouping",
  }));

const nullsSuggestions = (query: string, textPrefix = ""): Suggestion[] =>
  ["nulls first", "nulls last"]
    .filter((item) => item.startsWith(query.trim().toLowerCase()))
    .map((item) => ({
      text: `${textPrefix}${item}`,
      label: item,
      hint: "sort modifier",
      appendSpace: false,
    }));

const gqlFormulaValueSuggestions = (fields: Field[], query: string, suggestCtx: SuggestContext, textPrefix = ""): Suggestion[] =>
  formulaValueSuggestions(formulaFieldRefs(fields), query, suggestCtx, textPrefix).filter(
    (item) => !GQL_REMOVED_FORMULA_FUNCTIONS.has(String(item.label ?? "").toUpperCase()),
  );

const fieldOrFormulaSuggestions = (
  ctx: QueryCompletionContext,
  query: string,
  suggestCtx: SuggestContext,
  textPrefix = "",
): Suggestion[] => {
  if (isFormulaPosition(suggestCtx)) {
    return gqlFormulaValueSuggestions(sourceFields(ctx, suggestCtx.fullText), query, suggestCtx, textPrefix);
  }
  return fieldSuggestions(ctx, query, suggestCtx).map((item) => ({
    ...item,
    text: `${textPrefix}${item.text}`,
    expansion: item.expansion ? `${textPrefix}${item.expansion}` : undefined,
  }));
};

const previousWords = (ctx: SuggestContext): string[] =>
  lineBeforeCaret(ctx)
    .slice(0, Math.max(0, ctx.tokenStart - (ctx.fullText.slice(0, ctx.caret).lastIndexOf("\n") + 1)))
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(lower);

const spaceSuggestions = (ctx: QueryCompletionContext, query: string, suggestCtx: SuggestContext): Suggestion[] => {
  const words = previousWords(suggestCtx);
  const last = words[words.length - 1] ?? "";
  const previous = words[words.length - 2] ?? "";
  const line = lineBeforeCaret(suggestCtx);
  const clause = clauseForLine(line);

  if (last === "from")
    return [
      { text: " table ", label: "table", hint: "source", appendSpace: false },
      { text: " view ", label: "view", hint: "source", appendSpace: false },
    ];
  if (last === "join") return [{ text: " table ", label: "table", hint: "join source", appendSpace: false }];
  if ((last === "table" || last === "view") && previous === "from") return sourceSuggestions(ctx, query, last);
  if (last === "table" && previous === "join") return sourceSuggestions(ctx, query, "table");
  if (clause === "from" && fromSourcePositionKind(suggestCtx) === null)
    return keywordSuggestions(query, suggestCtx).map((item) => ({ ...item, text: `${nextClausePrefix(line)}${item.text}` }));
  if (clause === "join" && joinSourcePositionKind(suggestCtx) === null)
    return keywordSuggestions(query, suggestCtx).map((item) => ({ ...item, text: `${nextClausePrefix(line)}${item.text}` }));
  if (last === "left") return [{ text: " join table ", label: "join table", hint: "left join", appendSpace: false }];
  if (last === "as") return [];
  if (last === "on") return fieldOrFormulaSuggestions(ctx, query, suggestCtx, " ");
  if (last === "by" && previous === "group") return fieldOrFormulaSuggestions(ctx, query, suggestCtx, " ");
  if (last === "by" && clause === "group") return granularitySuggestions(query).map((item) => ({ ...item, text: ` ${item.text}` }));
  if (last === "aggregate") return aggregateSuggestions(query).map((item) => ({ ...item, text: ` ${item.text}` }));
  if (last === "in" && clause === "search")
    return fieldSuggestions(ctx, query, suggestCtx).map((item) => ({
      ...item,
      text: ` ${item.text}`,
      expansion: item.expansion ? ` ${item.expansion}` : undefined,
    }));
  if (last === "where" || last === "having")
    return gqlFormulaValueSuggestions(sourceFields(ctx, suggestCtx.fullText), query, suggestCtx, " ");
  if (last === "sort") return fieldOrFormulaSuggestions(ctx, query, suggestCtx, " ");
  if (clause === "sort" && (last === "asc" || last === "desc")) {
    return nullsSuggestions(query, " ");
  }
  if (clause === "sort" && last === "nulls")
    return ["first", "last"]
      .filter((item) => item.startsWith(query.trim().toLowerCase()))
      .map((item) => ({ text: ` ${item}`, label: item, hint: "null ordering", appendSpace: false }));
  if (last === "select") return fieldOrFormulaSuggestions(ctx, query, suggestCtx, " ");
  if (CLAUSE_KEYWORDS.has(last)) return [];
  return keywordSuggestions(query, suggestCtx).map((item) => ({ ...item, text: `${nextClausePrefix(line)}${item.text}` }));
};

export const buildQueryCompletions = (ctx: QueryCompletionContext): Completion[] => [
  {
    dropdown: true,
    suggest: (query, suggestCtx) => {
      const clause = clauseForLine(lineBeforeCaret(suggestCtx));
      const fromKind = fromSourcePositionKind(suggestCtx);
      if (fromKind !== null) {
        const kind = fromKind ?? undefined;
        return sourceSuggestions(ctx, query, kind);
      }
      const joinKind = joinSourcePositionKind(suggestCtx);
      if (joinKind !== null) {
        return sourceSuggestions(ctx, query, "table");
      }
      if (isFormulaPosition(suggestCtx)) return gqlFormulaValueSuggestions(sourceFields(ctx, suggestCtx.fullText), query, suggestCtx);
      if (clause === "aggregate") return aggregateSuggestions(query);
      if (clause === "group" && previousWords(suggestCtx).at(-1) === "by") return granularitySuggestions(query);
      const words = previousWords(suggestCtx);
      const last = words.at(-1);
      if (clause === "sort" && last === "nulls")
        return ["first", "last"]
          .filter((item) => item.startsWith(query.trim().toLowerCase()))
          .map((item) => ({ text: item, label: item, hint: "null ordering", appendSpace: false }));
      if (clause === "sort" && (last === "asc" || last === "desc")) {
        return nullsSuggestions(query);
      }
      return keywordSuggestions(query, suggestCtx);
    },
  },
  {
    trigger: " ",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query, suggestCtx) => spaceSuggestions(ctx, query, suggestCtx),
  },
  {
    trigger: "(",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query, suggestCtx) => {
      const before = suggestCtx.fullText.slice(0, suggestCtx.tokenStart).toLowerCase();
      if (/\baggregate\s+[a-z]*$/i.test(before)) return fieldOrFormulaSuggestions(ctx, query, suggestCtx, "(");
      return isFormulaPosition(suggestCtx)
        ? gqlFormulaValueSuggestions(sourceFields(ctx, suggestCtx.fullText), query, suggestCtx, "(")
        : [];
    },
  },
  ...[",", "+", "-", "*", "/", "%", "=", "<", ">"].map(
    (trigger): Completion => ({
      trigger,
      dropdown: true,
      allowAfterWord: true,
      suggest: (query, suggestCtx) => fieldOrFormulaSuggestions(ctx, query, suggestCtx, trigger),
    }),
  ),
  {
    trigger: ".",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query, suggestCtx) =>
      fieldSuggestions(ctx, query, suggestCtx).map((item) => ({ ...item, text: `.${item.text}`, expansion: `.${item.expansion}` })),
  },
];
