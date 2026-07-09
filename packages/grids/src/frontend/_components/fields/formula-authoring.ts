import type { Completion, SuggestContext, Suggestion } from "@valentinkolb/cloud/ui";
import { type FormulaFunction, type FormulaValueType, GRID_FORMULA_FUNCTIONS } from "../../../formula/function-catalog";
import { formatIdentifierRef } from "../../../ref-syntax";
import type { Field } from "../../../service";

type FormulaFieldRef = {
  id: string;
  shortId: string;
  name: string;
  type: string;
};

/**
 * Canonical reference syntax for newly authored formulas.
 *
 * Stored formulas still evaluate legacy `#shortId` and `{fieldId}` references
 * for compatibility, but UI completions and reference tables must emit this
 * field-name form so users see one obvious way to write new formulas.
 */
export const formulaFieldToken = (field: Pick<FormulaFieldRef, "name">): string => formatIdentifierRef(field.name);

const FUNCTION_BY_NAME = new Map(GRID_FORMULA_FUNCTIONS.map((fn) => [fn.name, fn]));

const NUMERIC_TYPES = new Set(["number", "percent", "duration", "rollup", "formula"]);
const TEXT_TYPES = new Set(["text", "longtext", "select", "id", "lookup", "formula"]);
const DATE_TYPES = new Set(["date", "created_at", "updated_at", "formula"]);
const BOOLEAN_TYPES = new Set(["boolean", "formula"]);
const UNSUITABLE_FIELD_TYPES = new Set(["file", "relation", "json"]);

export const formulaFieldRefs = (fields: Field[], currentFieldId?: string): FormulaFieldRef[] =>
  fields
    .filter((field) => !field.deletedAt && field.id !== currentFieldId && !UNSUITABLE_FIELD_TYPES.has(field.type))
    .map((field) => ({
      id: field.id,
      shortId: field.shortId,
      name: field.name,
      type: field.type,
    }));

const isFieldCompatible = (field: FormulaFieldRef, expected: FormulaValueType): boolean => {
  if (expected === "any") return true;
  if (expected === "number") return NUMERIC_TYPES.has(field.type);
  if (expected === "text") return TEXT_TYPES.has(field.type);
  if (expected === "date") return DATE_TYPES.has(field.type);
  if (expected === "boolean") return BOOLEAN_TYPES.has(field.type);
  return true;
};

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isAlpha = (ch: string | undefined): boolean => !!ch && /[A-Za-z_]/.test(ch);
const isAlphaNum = (ch: string | undefined): boolean => !!ch && /[A-Za-z0-9_]/.test(ch);
const isRefChar = (ch: string | undefined): boolean => !!ch && /[A-Za-z0-9]/.test(ch);
const isDigit = (ch: string | undefined): boolean => !!ch && /[0-9]/.test(ch);
const isFormulaOperator = (ch: string): boolean => /[()+\-*/%,=<>!]/.test(ch);

const suggestionNeedle = (field: FormulaFieldRef): string => `${field.name} ${field.shortId} ${field.type}`.toLowerCase();

const fieldSuggestion = (field: FormulaFieldRef, textPrefix = ""): Suggestion => ({
  text: `${textPrefix}${field.name}`,
  expansion: `${textPrefix}${formulaFieldToken(field)}`,
  label: field.name,
  hint: `${field.type} · ${formulaFieldToken(field)}`,
});

const functionSuggestion = (fn: FormulaFunction, textPrefix = ""): Suggestion => ({
  text: `${textPrefix}${fn.name}(`,
  label: fn.name,
  hint: fn.signature,
});

const previousSignificantChar = (text: string): string => {
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (!/\s/.test(ch)) return ch;
  }
  return "";
};

type CallFrame = {
  name: string;
  argIndex: number;
};

const currentCallFrame = (text: string): CallFrame | null => {
  const stack: CallFrame[] = [];
  let pendingIdent = "";
  let inString: "'" | '"' | null = null;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      pendingIdent = "";
      inString = ch;
      continue;
    }
    if (/[A-Za-z0-9_]/.test(ch)) {
      pendingIdent += ch;
      continue;
    }
    if (ch === "(") {
      const name = pendingIdent.toUpperCase();
      stack.push({ name: FUNCTION_BY_NAME.has(name) ? name : "", argIndex: 0 });
      pendingIdent = "";
      continue;
    }
    pendingIdent = "";
    if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top) top.argIndex++;
    } else if (ch === ")") {
      stack.pop();
    }
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!;
    if (frame.name) return frame;
  }
  return null;
};

export const expectedFormulaValueType = (text: string, tokenStart: number): FormulaValueType => {
  const before = text.slice(0, tokenStart);
  const prev = previousSignificantChar(before);
  if (prev === "-" || prev === "*" || prev === "/" || prev === "%") return "number";

  const frame = currentCallFrame(before);
  if (!frame) return "any";
  const fn = FUNCTION_BY_NAME.get(frame.name);
  if (!fn || fn.args.length === 0) return "any";
  return fn.args[Math.min(frame.argIndex, fn.args.length - 1)]?.type ?? "any";
};

const matchesQuery = (field: FormulaFieldRef, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return suggestionNeedle(field).includes(q);
};

export const formulaValueSuggestions = (
  fields: FormulaFieldRef[],
  query: string,
  ctx: Pick<SuggestContext, "fullText" | "tokenStart">,
  textPrefix = "",
): Suggestion[] => {
  const expected = expectedFormulaValueType(ctx.fullText, ctx.tokenStart);
  const q = query.trim().toLowerCase();
  const fieldSuggestions = fields
    .filter((field) => matchesQuery(field, query))
    .sort((a, b) => Number(isFieldCompatible(b, expected)) - Number(isFieldCompatible(a, expected)))
    .map((field) => fieldSuggestion(field, textPrefix));

  const fnSuggestions = GRID_FORMULA_FUNCTIONS.filter((fn) => expected === "any" || fn.returnType === expected || fn.returnType === "any")
    .filter((fn) => fn.name.toLowerCase().startsWith(q))
    .map((fn) => functionSuggestion(fn, textPrefix));

  return [...fieldSuggestions.slice(0, 40), ...fnSuggestions];
};

const isWhitespaceValuePosition = (text: string, tokenStart: number): boolean => {
  const prev = previousSignificantChar(text.slice(0, tokenStart));
  return prev === "(" || prev === "," || prev === "+" || prev === "-" || prev === "*" || prev === "/" || prev === "%";
};

export const buildFormulaCompletions = (fields: FormulaFieldRef[]): Completion[] => [
  {
    trigger: "=",
    dropdown: true,
    suggest: (query, ctx) =>
      ctx.fullText.slice(0, ctx.tokenStart).trim().length > 0
        ? []
        : GRID_FORMULA_FUNCTIONS.filter((fn) => fn.name.startsWith(query.toUpperCase())).map((fn) => functionSuggestion(fn, "=")),
  },
  {
    trigger: "#",
    dropdown: true,
    // Compatibility affordance: users may start searching with the old hash
    // prefix, but accepting a suggestion writes the canonical field-name ref.
    suggest: (query) =>
      fields
        .filter((field) => matchesQuery(field, query))
        .map((field) => ({
          ...fieldSuggestion(field, "#"),
          text: `#${field.name}`,
          expansion: formulaFieldToken(field),
        })),
  },
  {
    dropdown: true,
    suggest: (query, ctx) => formulaValueSuggestions(fields, query, ctx),
  },
  {
    trigger: " ",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query: string, ctx: SuggestContext) =>
      isWhitespaceValuePosition(ctx.fullText, ctx.tokenStart) ? formulaValueSuggestions(fields, query, ctx) : [],
  },
  ...["(", ",", "+", "-", "*", "/", "%"].map((trigger) => ({
    trigger,
    dropdown: true,
    allowAfterWord: true,
    suggest: (query: string, ctx: SuggestContext) => formulaValueSuggestions(fields, query, ctx, trigger),
  })),
];

export const formulaHighlight = (text: string): string => {
  const span = (klass: string, value: string): string => `<span class="${klass}">${escapeHtml(value)}</span>`;

  const quotedTokenEnd = (start: number): number => {
    const quote = text[start]!;
    let end = start + 1;
    let escaped = false;
    while (end < text.length) {
      const ch = text[end]!;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) return end + 1;
      end++;
    }
    return end;
  };

  const readWhile = (start: number, predicate: (ch: string | undefined) => boolean): number => {
    let end = start;
    while (end < text.length && predicate(text[end])) end++;
    return end;
  };

  const numberTokenEnd = (start: number): number => {
    let end = readWhile(start + 1, isDigit);
    if (text[end] === "." && isDigit(text[end + 1])) {
      end = readWhile(end + 1, isDigit);
    }
    return end;
  };

  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "'") {
      const end = quotedTokenEnd(i);
      out += span("str", text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === '"') {
      const end = quotedTokenEnd(i);
      out += span("field", text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === "#") {
      const end = readWhile(i + 1, isRefChar);
      out += span("field", text.slice(i, end));
      i = end;
      continue;
    }
    if (isDigit(ch)) {
      const end = numberTokenEnd(i);
      out += span("num", text.slice(i, end));
      i = end;
      continue;
    }
    if (isAlpha(ch)) {
      const end = readWhile(i + 1, isAlphaNum);
      const word = text.slice(i, end);
      out += FUNCTION_BY_NAME.has(word.toUpperCase()) ? span("fn", word) : span("field", word);
      i = end;
      continue;
    }
    if (isFormulaOperator(ch)) {
      out += span("op", ch);
      i++;
      continue;
    }
    out += escapeHtml(ch);
    i++;
  }
  return out;
};
