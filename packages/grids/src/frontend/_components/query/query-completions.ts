import type { Completion, SuggestContext, Suggestion } from "@valentinkolb/cloud/ui";
import { formulaFieldRefs, formulaValueSuggestions } from "../fields/formula-authoring";
import { formatIdentifierRef, normalizeRefKey, parseIdentifierRef } from "../../../ref-syntax";
import type { Field, Table, View } from "../../../service";

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
  { text: "where formula(", label: "where", hint: "Filter with a formula" },
  { text: "join table ", label: "join table", hint: "Inner join on a relation", appendSpace: false },
  { text: "left join table ", label: "left join table", hint: "Keep rows without a match", appendSpace: false },
  { text: "group by ", label: "group by", hint: "Bucket records", appendSpace: false },
  { text: "aggregate ", label: "aggregate", hint: "Calculate grouped values" },
  { text: "having formula(", label: "having", hint: "Filter grouped output" },
  { text: "sort ", label: "sort", hint: "Order rows or groups" },
  { text: "limit ", label: "limit", hint: "Maximum rows" },
  { text: "skip ", label: "skip", hint: "Offset rows" },
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
  "limit",
  "skip",
  "offset",
]);

const AGGREGATE_FUNCTIONS = ["count", "countEmpty", "countUnique", "sum", "avg", "min", "max", "median", "earliest", "latest"];
const GROUP_GRANULARITIES = ["day", "week", "month", "quarter", "year"];

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

const clauseForLine = (line: string): string => {
  const trimmed = line.trimStart().toLowerCase();
  if (trimmed.startsWith("left join ")) return "join";
  if (trimmed.startsWith("join ")) return "join";
  if (trimmed.startsWith("group by ")) return "group";
  return trimmed.split(/\s+/, 1)[0] ?? "";
};

const isFromSourcePosition = (ctx: SuggestContext) => /\bfrom\s+(?:table|view)?\s*(?:"[^"]*"?|#?[A-Za-z0-9_]*)$/i.test(lineBeforeCaret(ctx));
const isJoinSourcePosition = (ctx: SuggestContext) => /\bjoin\s+(?:table|view)?\s*(?:"[^"]*"?|#?[A-Za-z0-9_]*)$/i.test(lineBeforeCaret(ctx));
const isFormulaPosition = (ctx: SuggestContext) => {
  const line = lineBeforeCaret(ctx).toLowerCase();
  return /\b(where|having)\s+/.test(line) || /\bformula\([\s\S]*$/i.test(line) || /[()+\-*/%,=<>!]\s*#?[A-Za-z0-9_]*$/i.test(line);
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
  const match = fullText.match(/\bfrom\s+(?:(?:table|view)\s+)?(?<ref>"[^"]+"|#[A-Za-z0-9_]+|[A-Za-z_][A-Za-z0-9_]*)/i);
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

const keywordSuggestions = (query: string): Suggestion[] => {
  const q = query.trim().toLowerCase();
  return KEYWORDS.filter((item) => !q || item.text.toLowerCase().startsWith(q) || item.label?.toLowerCase().startsWith(q)).slice(0, 20);
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

const fieldOrFormulaSuggestions = (
  ctx: QueryCompletionContext,
  query: string,
  suggestCtx: SuggestContext,
  textPrefix = "",
): Suggestion[] => {
  if (isFormulaPosition(suggestCtx)) {
    return formulaValueSuggestions(formulaFieldRefs(sourceFields(ctx, suggestCtx.fullText)), query, suggestCtx, textPrefix);
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
  if (last === "table" || last === "view") return sourceSuggestions(ctx, query, last);
  if (last === "join")
    return [
      { text: " table ", label: "table", hint: "join source", appendSpace: false },
      { text: " view ", label: "view", hint: "join source", appendSpace: false },
    ];
  if (last === "left") return [{ text: " join table ", label: "join table", hint: "left join", appendSpace: false }];
  if (last === "as") return [];
  if (last === "on") return fieldOrFormulaSuggestions(ctx, query, suggestCtx, " ");
  if (last === "by" && previous === "group") return fieldOrFormulaSuggestions(ctx, query, suggestCtx, " ");
  if (last === "by" && clause === "group") return granularitySuggestions(query).map((item) => ({ ...item, text: ` ${item.text}` }));
  if (last === "aggregate") return aggregateSuggestions(query).map((item) => ({ ...item, text: ` ${item.text}` }));
  if (last === "sort") return fieldOrFormulaSuggestions(ctx, query, suggestCtx, " ");
  if (last === "select") return fieldOrFormulaSuggestions(ctx, query, suggestCtx, " ");
  if (CLAUSE_KEYWORDS.has(last)) return [];
  return keywordSuggestions(query).map((item) => ({ ...item, text: ` ${item.text}` }));
};

export const buildQueryCompletions = (ctx: QueryCompletionContext): Completion[] => [
  {
    dropdown: true,
    suggest: (query, suggestCtx) => {
      const clause = clauseForLine(lineBeforeCaret(suggestCtx));
      if (isFromSourcePosition(suggestCtx)) {
        const line = lineBeforeCaret(suggestCtx).toLowerCase();
        const kind = /\bfrom\s+table\s+/i.test(line) ? "table" : /\bfrom\s+view\s+/i.test(line) ? "view" : undefined;
        return sourceSuggestions(ctx, query, kind);
      }
      if (isJoinSourcePosition(suggestCtx)) {
        const line = lineBeforeCaret(suggestCtx).toLowerCase();
        const kind = /\bjoin\s+table\s+/i.test(line) ? "table" : /\bjoin\s+view\s+/i.test(line) ? "view" : undefined;
        return sourceSuggestions(ctx, query, kind);
      }
      if (isFormulaPosition(suggestCtx))
        return formulaValueSuggestions(formulaFieldRefs(sourceFields(ctx, suggestCtx.fullText)), query, suggestCtx);
      if (clause === "aggregate") return aggregateSuggestions(query);
      if (clause === "group" && previousWords(suggestCtx).at(-1) === "by") return granularitySuggestions(query);
      return keywordSuggestions(query);
    },
  },
  {
    trigger: " ",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query, suggestCtx) => spaceSuggestions(ctx, query, suggestCtx),
  },
  {
    trigger: "#",
    dropdown: true,
    suggest: (query, suggestCtx) => {
      if (isFromSourcePosition(suggestCtx)) {
        const line = lineBeforeCaret(suggestCtx).toLowerCase();
        const kind = /\bfrom\s+table\s+/i.test(line) ? "table" : /\bfrom\s+view\s+/i.test(line) ? "view" : undefined;
        return sourceSuggestions(ctx, query, kind);
      }
      if (isJoinSourcePosition(suggestCtx)) {
        const line = lineBeforeCaret(suggestCtx).toLowerCase();
        const kind = /\bjoin\s+table\s+/i.test(line) ? "table" : /\bjoin\s+view\s+/i.test(line) ? "view" : undefined;
        return sourceSuggestions(ctx, query, kind);
      }
      return fieldOrFormulaSuggestions(ctx, query, suggestCtx);
    },
  },
  {
    trigger: "(",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query, suggestCtx) => {
      const before = suggestCtx.fullText.slice(0, suggestCtx.tokenStart).toLowerCase();
      if (/\baggregate\s+[a-z]*$/i.test(before)) return fieldOrFormulaSuggestions(ctx, query, suggestCtx, "(");
      return isFormulaPosition(suggestCtx)
        ? formulaValueSuggestions(formulaFieldRefs(sourceFields(ctx, suggestCtx.fullText)), query, suggestCtx, "(")
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
