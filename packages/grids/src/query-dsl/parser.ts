import { parseFormula } from "../formula/parser";
import type { Expr } from "../formula/types";
import type {
  DslAggregateFn,
  DslAggregateItem,
  DslGroupItem,
  DslJoin,
  DslParseDiagnostic,
  DslParseResult,
  DslQualifiedRef,
  DslQueryAst,
  DslSelectItem,
  DslSortItem,
  DslSourceKind,
  DslSourceRef,
} from "./types";

const ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9_]{0,79}$/;
const GROUP_GRANULARITIES = new Set(["day", "week", "month", "quarter", "year"]);
const AGGREGATE_FNS = new Set<DslAggregateFn>([
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
]);
const RESERVED_ALIASES = new Set([
  "aggregate",
  "and",
  "as",
  "by",
  "desc",
  "from",
  "group",
  "having",
  "join",
  "left",
  "limit",
  "on",
  "or",
  "offset",
  "select",
  "skip",
  "sort",
  "where",
]);
const INLINE_CLAUSE_STARTS = [
  "left join",
  "group by",
  "aggregate",
  "select",
  "where",
  "having",
  "offset",
  "limit",
  "skip",
  "sort",
  "join",
  "from",
];

const emptyAst = (): DslQueryAst => ({
  joins: [],
  select: [],
  groupBy: [],
  aggregations: [],
  sort: [],
});

const error = (line: number, message: string): DslParseDiagnostic => ({ line, message });

const stripComment = (line: string): string => {
  let quote: string | null = null;
  let braceDepth = 0;
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
    if (braceDepth > 0) {
      if (c === "{") braceDepth++;
      if (c === "}") braceDepth--;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "{") {
      braceDepth++;
      continue;
    }
    if (c === "-" && line[i + 1] === "-") return line.slice(0, i);
  }
  return line;
};

const isWhitespace = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

const previousWord = (line: string, index: number): string | null => {
  const prefix = line.slice(0, index).trimEnd();
  const match = prefix.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
  return match?.[1]?.toLowerCase() ?? null;
};

const previousNonWhitespace = (line: string, index: number): string | null => {
  for (let i = index - 1; i >= 0; i--) {
    const c = line[i]!;
    if (!isWhitespace(c)) return c;
  }
  return null;
};

const nextNonWhitespace = (line: string, index: number): string | null => {
  for (let i = index; i < line.length; i++) {
    const c = line[i]!;
    if (!isWhitespace(c)) return c;
  }
  return null;
};

const EMPTY_INLINE_CLAUSE_BODIES = new Set([
  "from",
  "select",
  "where",
  "left join",
  "join",
  "group by",
  "aggregate",
  "having",
  "sort",
  "limit",
  "offset",
  "skip",
]);

const looksLikeFormulaCallName = (line: string, index: number, clauseLength: number, segmentStart: number): boolean => {
  if (nextNonWhitespace(line, index + clauseLength) !== "(") return false;
  const previous = previousNonWhitespace(line, index);
  if (previous && "+-*/(<>=!,".includes(previous)) return true;
  return EMPTY_INLINE_CLAUSE_BODIES.has(line.slice(segmentStart, index).trim().toLowerCase());
};

const startsInlineClauseAt = (line: string, lower: string, index: number, segmentStart: number): boolean => {
  if (index === 0 || !isWhitespace(line[index - 1])) return false;
  const prev = previousWord(line, index);
  if (prev === "as") return false;
  for (const clause of INLINE_CLAUSE_STARTS) {
    if (clause === "join" && prev === "left") continue;
    if (!lower.startsWith(clause, index)) continue;
    if (looksLikeFormulaCallName(line, index, clause.length, segmentStart)) continue;
    if (isWhitespace(line[index + clause.length])) return true;
  }
  return false;
};

const splitInlineClauses = (line: string): string[] => {
  const trimmed = stripComment(line).trim();
  if (!trimmed) return [];

  const clauses: string[] = [];
  const lower = trimmed.toLowerCase();
  let start = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let quote: string | null = null;

  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]!;
    if (quote) {
      if (c === "\\" && i + 1 < trimmed.length) {
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
    if (c === "{") {
      braceDepth++;
      continue;
    }
    if (c === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (braceDepth > 0) continue;
    if (c === "(") {
      parenDepth++;
      continue;
    }
    if (c === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (parenDepth === 0 && startsInlineClauseAt(trimmed, lower, i, start)) {
      const previous = trimmed.slice(start, i).trim();
      if (previous) clauses.push(previous);
      start = i;
    }
  }

  const tail = trimmed.slice(start).trim();
  if (tail) clauses.push(tail);
  return clauses;
};

const splitTopLevel = (input: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote) {
      if (c === "\\" && i + 1 < input.length) {
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
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth < 0) throw new Error("unbalanced closing parenthesis");
    if (c === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote) throw new Error("unterminated string literal");
  if (depth !== 0) throw new Error("unbalanced parenthesis");
  const tail = input.slice(start).trim();
  if (!tail && input.trimEnd().endsWith(",")) throw new Error("trailing comma");
  if (tail) parts.push(tail);
  return parts;
};

const splitAlias = (input: string): { value: string; alias?: string } => {
  const match = input.match(/^(?<value>[\s\S]+?)\s+as\s+(?<alias>[A-Za-z_][A-Za-z0-9_]*)$/i);
  if (!match?.groups) return { value: input.trim() };
  const value = match.groups.value;
  const alias = match.groups.alias;
  if (!value || !alias) return { value: input.trim() };
  return { value: value.trim(), alias };
};

const validateAlias = (alias: string, line: number): DslParseDiagnostic | null => {
  if (!ALIAS_RE.test(alias)) return error(line, `invalid alias "${alias}"`);
  if (RESERVED_ALIASES.has(alias.toLowerCase())) return error(line, `alias "${alias}" is reserved`);
  return null;
};

const isIdentifierPart = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_]/.test(c);

const parseRef = (input: string): DslQualifiedRef | null => {
  const trimmed = input.trim();
  const match = trimmed.match(/^(?:(?<scope>[A-Za-z_][A-Za-z0-9_]*)\.)?#(?<ref>[A-Za-z0-9][A-Za-z0-9_]*)$/);
  if (!match?.groups) return null;
  const ref = match.groups.ref;
  if (!ref) return null;
  if (!REF_RE.test(ref)) return null;
  if (match.groups.scope && validateAlias(match.groups.scope, 0)) return null;
  return {
    ...(match.groups.scope ? { scope: match.groups.scope } : {}),
    ref,
  };
};

const parseSource = (input: string): DslSourceRef | null => {
  const trimmed = input.trim();
  const typed = trimmed.match(/^(?<kind>table|view)\s+#(?<ref>[A-Za-z0-9][A-Za-z0-9_]*)$/i);
  if (typed?.groups) {
    const kind = typed.groups.kind?.toLowerCase();
    const ref = typed.groups.ref;
    if ((kind !== "table" && kind !== "view") || !ref) return null;
    if (!REF_RE.test(ref)) return null;
    return { kind, ref };
  }
  const untyped = trimmed.match(/^#(?<ref>[A-Za-z0-9][A-Za-z0-9_]*)$/);
  if (untyped?.groups?.ref && REF_RE.test(untyped.groups.ref)) return { kind: "unknown", ref: untyped.groups.ref };
  return null;
};

const unwrapFormulaCall = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed.toLowerCase().startsWith("formula(") || !trimmed.endsWith(")")) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = "formula".length; i < trimmed.length; i++) {
    const c = trimmed[i]!;
    if (quote) {
      if (c === "\\" && i + 1 < trimmed.length) {
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
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth === 0 && i < trimmed.length - 1) return null;
  }
  if (depth !== 0 || quote) return null;
  return trimmed.slice("formula(".length, -1).trim();
};

const normalizeFormulaWrappers = (input: string): string => {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote) {
      out += c;
      if (c === "\\" && i + 1 < input.length) {
        out += input[i + 1]!;
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    if (!isIdentifierPart(input[i - 1]) && input.slice(i, i + "formula(".length).toLowerCase() === "formula(") {
      out += "(";
      i += "formula(".length - 1;
      continue;
    }
    out += c;
  }
  return out;
};

const parseExpression = (
  source: string,
  line: number,
): { ok: true; expression: Expr; source: string } | { ok: false; diagnostic: DslParseDiagnostic } => {
  const expressionSource = normalizeFormulaWrappers(unwrapFormulaCall(source) ?? source.trim());
  if (!expressionSource) return { ok: false, diagnostic: error(line, "missing expression") };
  const parsed = parseFormula(expressionSource);
  if (!parsed.ok) return { ok: false, diagnostic: error(line, parsed.error) };
  return { ok: true, expression: parsed.ast, source: expressionSource };
};

const normalizeAggregateFn = (fn: string): DslAggregateFn | null => {
  const lower = fn.toLowerCase();
  if (lower === "countempty") return "countEmpty";
  if (lower === "countunique") return "countUnique";
  if (AGGREGATE_FNS.has(lower as DslAggregateFn)) return lower as DslAggregateFn;
  return null;
};

const parseSelectItem = (input: string, line: number): { item?: DslSelectItem; diagnostic?: DslParseDiagnostic } => {
  const { value, alias } = splitAlias(input);
  const formulaSource = unwrapFormulaCall(value);
  if (formulaSource !== null) {
    if (!alias) return { diagnostic: error(line, "formula select items need an alias") };
    const aliasError = validateAlias(alias, line);
    if (aliasError) return { diagnostic: aliasError };
    const expr = parseExpression(formulaSource, line);
    if (!expr.ok) return { diagnostic: expr.diagnostic };
    return { item: { kind: "formula", expression: expr.expression, source: expr.source, alias } };
  }
  const field = parseRef(value);
  if (!field) return { diagnostic: error(line, `invalid select item "${input}"`) };
  if (alias) {
    const aliasError = validateAlias(alias, line);
    if (aliasError) return { diagnostic: aliasError };
  }
  return { item: { kind: "field", field, ...(alias ? { alias } : {}) } };
};

const parseAggregateItem = (input: string, line: number): { item?: DslAggregateItem; diagnostic?: DslParseDiagnostic } => {
  const { value, alias } = splitAlias(input);
  if (!alias) return { diagnostic: error(line, "aggregate items need an alias") };
  const aliasError = validateAlias(alias, line);
  if (aliasError) return { diagnostic: aliasError };
  const match = value.match(/^(?<fn>[A-Za-z][A-Za-z0-9_]*)\((?<arg>[\s\S]*)\)$/);
  if (!match?.groups) return { diagnostic: error(line, `invalid aggregate item "${input}"`) };
  const fnRaw = match.groups.fn;
  const argRaw = match.groups.arg;
  if (!fnRaw || argRaw === undefined) return { diagnostic: error(line, `invalid aggregate item "${input}"`) };
  const fn = normalizeAggregateFn(fnRaw);
  if (!fn) return { diagnostic: error(line, `unsupported aggregate "${fnRaw}"`) };
  const arg = argRaw.trim();
  if (arg === "*") return { item: { fn, argument: "*", alias } };
  const formulaSource = unwrapFormulaCall(arg);
  if (formulaSource !== null) {
    const expr = parseExpression(formulaSource, line);
    if (!expr.ok) return { diagnostic: expr.diagnostic };
    return { item: { fn, argument: { kind: "formula", expression: expr.expression, source: expr.source }, alias } };
  }
  const ref = parseRef(arg);
  if (!ref) return { diagnostic: error(line, `invalid aggregate argument "${arg}"`) };
  return { item: { fn, argument: ref, alias } };
};

const parseGroupItem = (input: string, line: number): { item?: DslGroupItem; diagnostic?: DslParseDiagnostic } => {
  const match = input
    .trim()
    .match(/^(?<field>(?:[A-Za-z_][A-Za-z0-9_]*\.)?#[A-Za-z0-9][A-Za-z0-9_]*)(?:\s+by\s+(?<granularity>[A-Za-z]+))?$/i);
  if (!match?.groups) return { diagnostic: error(line, `invalid group item "${input}"`) };
  const fieldRaw = match.groups.field;
  if (!fieldRaw) return { diagnostic: error(line, `invalid group item "${input}"`) };
  const field = parseRef(fieldRaw);
  if (!field) return { diagnostic: error(line, `invalid group field "${input}"`) };
  const granularity = match.groups.granularity?.toLowerCase();
  if (granularity && !GROUP_GRANULARITIES.has(granularity))
    return { diagnostic: error(line, `unsupported group granularity "${granularity}"`) };
  return { item: { field, ...(granularity ? { granularity: granularity as DslGroupItem["granularity"] } : {}) } };
};

const parseSortItem = (input: string, line: number): { item?: DslSortItem; diagnostic?: DslParseDiagnostic } => {
  const match = input
    .trim()
    .match(
      /^(?<target>(?:[A-Za-z_][A-Za-z0-9_]*\.)?#[A-Za-z0-9][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)(?:\s+(?<direction>asc|desc|ascending|descending))?$/i,
    );
  if (!match?.groups) return { diagnostic: error(line, `invalid sort item "${input}"`) };
  const target = match.groups.target;
  if (!target) return { diagnostic: error(line, `invalid sort item "${input}"`) };
  const directionRaw = match.groups.direction?.toLowerCase();
  const direction = directionRaw === "desc" || directionRaw === "descending" ? "desc" : "asc";
  const ref = parseRef(target);
  if (ref) return { item: { target: ref, direction } };
  const aliasError = validateAlias(target, line);
  if (aliasError) return { diagnostic: aliasError };
  return { item: { target: { kind: "alias", alias: target }, direction } };
};

const parseJoin = (lineSource: string, line: number): { item?: DslJoin; diagnostic?: DslParseDiagnostic } => {
  const match = lineSource.match(
    /^(?<mode>left\s+)?join\s+(?<source>(?:(?:table|view)\s+)?#[A-Za-z0-9][A-Za-z0-9_]*)\s+as\s+(?<alias>[A-Za-z_][A-Za-z0-9_]*)\s+on\s+(?<left>(?:[A-Za-z_][A-Za-z0-9_]*\.)?#[A-Za-z0-9][A-Za-z0-9_]*)\s*=\s*(?<right>(?:[A-Za-z_][A-Za-z0-9_]*\.)?#[A-Za-z0-9][A-Za-z0-9_]*)$/i,
  );
  if (!match?.groups) return { diagnostic: error(line, `invalid join clause`) };
  const sourceRaw = match.groups.source;
  const alias = match.groups.alias;
  const leftRaw = match.groups.left;
  const rightRaw = match.groups.right;
  if (!sourceRaw || !alias || !leftRaw || !rightRaw) return { diagnostic: error(line, "invalid join refs") };
  const source = parseSource(sourceRaw);
  const left = parseRef(leftRaw);
  const right = parseRef(rightRaw);
  const aliasError = validateAlias(alias, line);
  if (aliasError) return { diagnostic: aliasError };
  if (!source || !left || !right) return { diagnostic: error(line, "invalid join refs") };
  return {
    item: {
      mode: match.groups.mode ? "left" : "inner",
      source,
      alias,
      on: { left, right },
    },
  };
};

const validateJoinScopes = (join: DslJoin, availableScopes: Set<string>, line: number): DslParseDiagnostic | null => {
  if (availableScopes.has(join.alias)) return error(line, `duplicate join alias "${join.alias}"`);
  const sides = [join.on.left, join.on.right];
  const newAliasSides = sides.filter((side) => side.scope === join.alias).length;
  if (newAliasSides !== 1) return error(line, `join on must reference "${join.alias}" on exactly one side`);
  const unknownScope = sides.find((side) => side.scope && side.scope !== join.alias && !availableScopes.has(side.scope));
  if (unknownScope?.scope) return error(line, `unknown join scope "${unknownScope.scope}"`);
  return null;
};

const parseCommaItems = <T>(
  body: string,
  line: number,
  parseItem: (item: string, line: number) => { item?: T; diagnostic?: DslParseDiagnostic },
): { items: T[]; diagnostics: DslParseDiagnostic[] } => {
  const items: T[] = [];
  const diagnostics: DslParseDiagnostic[] = [];
  let parts: string[];
  try {
    parts = splitTopLevel(body);
  } catch (e) {
    return { items, diagnostics: [error(line, e instanceof Error ? e.message : String(e))] };
  }
  if (parts.length === 0) return { items, diagnostics: [error(line, "missing clause body")] };
  for (const part of parts) {
    const parsed = parseItem(part, line);
    if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
    if (parsed.item) items.push(parsed.item);
  }
  return { items, diagnostics };
};

const parseBoundedIntegerClause = (
  name: "limit" | "offset",
  body: string,
  line: number,
): { value?: number; diagnostic?: DslParseDiagnostic } => {
  if (!/^\d+$/.test(body)) {
    return { diagnostic: error(line, name === "limit" ? "limit must be a positive integer" : "offset must be a non-negative integer") };
  }
  const value = Number(body);
  const min = name === "limit" ? 1 : 0;
  if (!Number.isSafeInteger(value) || value < min || value > 10_000) {
    return { diagnostic: error(line, `${name} must be between ${min} and 10000`) };
  }
  return { value };
};

type Clause =
  | { kind: "from"; body: string }
  | { kind: "select"; body: string }
  | { kind: "where"; body: string }
  | { kind: "join"; body: string }
  | { kind: "group"; body: string }
  | { kind: "aggregate"; body: string }
  | { kind: "having"; body: string }
  | { kind: "sort"; body: string }
  | { kind: "limit"; body: string }
  | { kind: "offset"; body: string };

const readClause = (line: string): Clause | null => {
  const trimmed = line.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("from ")) return { kind: "from", body: trimmed.slice(5).trim() };
  if (lower.startsWith("select ")) return { kind: "select", body: trimmed.slice(7).trim() };
  if (lower.startsWith("where ")) return { kind: "where", body: trimmed.slice(6).trim() };
  if (lower.startsWith("left join ") || lower.startsWith("join ")) return { kind: "join", body: trimmed };
  if (lower.startsWith("group by ")) return { kind: "group", body: trimmed.slice(9).trim() };
  if (lower.startsWith("aggregate ")) return { kind: "aggregate", body: trimmed.slice(10).trim() };
  if (lower.startsWith("having ")) return { kind: "having", body: trimmed.slice(7).trim() };
  if (lower.startsWith("sort ")) return { kind: "sort", body: trimmed.slice(5).trim() };
  if (lower.startsWith("limit ")) return { kind: "limit", body: trimmed.slice(6).trim() };
  if (lower.startsWith("offset ")) return { kind: "offset", body: trimmed.slice(7).trim() };
  if (lower.startsWith("skip ")) return { kind: "offset", body: trimmed.slice(5).trim() };
  return null;
};

export const parseGridsQueryDsl = (source: string): DslParseResult => {
  const ast = emptyAst();
  const diagnostics: DslParseDiagnostic[] = [];
  const seenSingleton = new Set<"from" | "where" | "having" | "limit" | "offset">();
  const availableJoinScopes = new Set<string>();

  const pushSingletonError = (kind: "from" | "where" | "having" | "limit" | "offset", line: number): boolean => {
    if (!seenSingleton.has(kind)) {
      seenSingleton.add(kind);
      return false;
    }
    diagnostics.push(error(line, `duplicate ${kind} clause`));
    return true;
  };

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNo = index + 1;
    const lines = splitInlineClauses(rawLine);
    if (lines.length === 0) return;
    for (const line of lines) {
      const clause = readClause(line);
      if (!clause) {
        diagnostics.push(error(lineNo, "unknown clause"));
        continue;
      }

      if (clause.kind === "from") {
        if (pushSingletonError("from", lineNo)) continue;
        const parsed = parseSource(clause.body);
        if (!parsed) diagnostics.push(error(lineNo, "invalid from source"));
        else ast.source = parsed;
        continue;
      }

      if (clause.kind === "select") {
        const parsed = parseCommaItems(clause.body, lineNo, parseSelectItem);
        ast.select.push(...parsed.items);
        diagnostics.push(...parsed.diagnostics);
        continue;
      }

      if (clause.kind === "where") {
        if (pushSingletonError("where", lineNo)) continue;
        const parsed = parseExpression(clause.body, lineNo);
        if (parsed.ok) ast.where = { expression: parsed.expression, source: parsed.source };
        else diagnostics.push(parsed.diagnostic);
        continue;
      }

      if (clause.kind === "join") {
        const parsed = parseJoin(clause.body, lineNo);
        if (parsed.item) {
          const scopeError = validateJoinScopes(parsed.item, availableJoinScopes, lineNo);
          if (scopeError) diagnostics.push(scopeError);
          else {
            ast.joins.push(parsed.item);
            availableJoinScopes.add(parsed.item.alias);
          }
        }
        if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
        continue;
      }

      if (clause.kind === "group") {
        const parsed = parseCommaItems(clause.body, lineNo, parseGroupItem);
        ast.groupBy.push(...parsed.items);
        diagnostics.push(...parsed.diagnostics);
        continue;
      }

      if (clause.kind === "aggregate") {
        const parsed = parseCommaItems(clause.body, lineNo, parseAggregateItem);
        ast.aggregations.push(...parsed.items);
        diagnostics.push(...parsed.diagnostics);
        continue;
      }

      if (clause.kind === "having") {
        if (pushSingletonError("having", lineNo)) continue;
        const parsed = parseExpression(clause.body, lineNo);
        if (parsed.ok) ast.having = { expression: parsed.expression, source: parsed.source };
        else diagnostics.push(parsed.diagnostic);
        continue;
      }

      if (clause.kind === "sort") {
        const parsed = parseCommaItems(clause.body, lineNo, parseSortItem);
        ast.sort.push(...parsed.items);
        diagnostics.push(...parsed.diagnostics);
        continue;
      }

      if (clause.kind === "limit") {
        if (pushSingletonError("limit", lineNo)) continue;
        const parsed = parseBoundedIntegerClause("limit", clause.body, lineNo);
        if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
        else ast.limit = parsed.value;
        continue;
      }

      if (clause.kind === "offset") {
        if (pushSingletonError("offset", lineNo)) continue;
        const parsed = parseBoundedIntegerClause("offset", clause.body, lineNo);
        if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
        else ast.offset = parsed.value;
      }
    }
  });

  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, ast };
};
