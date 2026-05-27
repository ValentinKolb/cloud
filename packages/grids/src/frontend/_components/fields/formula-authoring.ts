import type { Completion, SuggestContext, Suggestion } from "@valentinkolb/cloud/ui";
import type { Field } from "../../../service";

type FormulaValueType = "any" | "number" | "text" | "boolean" | "date";

type FormulaArg = {
  label: string;
  type: FormulaValueType;
};

type FormulaFunction = {
  name: string;
  signature: string;
  description: string;
  args: FormulaArg[];
  returnType: FormulaValueType;
};

type FormulaFieldRef = {
  id: string;
  shortId: string;
  name: string;
  type: string;
};

export const formulaFieldToken = (field: Pick<FormulaFieldRef, "shortId">): string => `#${field.shortId}`;

export const GRID_FORMULA_FUNCTIONS: FormulaFunction[] = [
  {
    name: "SUM",
    signature: "SUM(value, ...)",
    description: "Add numeric values.",
    args: [{ label: "value", type: "number" }],
    returnType: "number",
  },
  {
    name: "AVG",
    signature: "AVG(value, ...)",
    description: "Average numeric values.",
    args: [{ label: "value", type: "number" }],
    returnType: "number",
  },
  {
    name: "MEAN",
    signature: "MEAN(value, ...)",
    description: "Alias for AVG.",
    args: [{ label: "value", type: "number" }],
    returnType: "number",
  },
  {
    name: "COUNT",
    signature: "COUNT(value, ...)",
    description: "Count non-empty values.",
    args: [{ label: "value", type: "any" }],
    returnType: "number",
  },
  {
    name: "MIN",
    signature: "MIN(value, ...)",
    description: "Smallest numeric value.",
    args: [{ label: "value", type: "number" }],
    returnType: "number",
  },
  {
    name: "MAX",
    signature: "MAX(value, ...)",
    description: "Largest numeric value.",
    args: [{ label: "value", type: "number" }],
    returnType: "number",
  },
  {
    name: "MEDIAN",
    signature: "MEDIAN(value, ...)",
    description: "Middle numeric value.",
    args: [{ label: "value", type: "number" }],
    returnType: "number",
  },
  {
    name: "ABS",
    signature: "ABS(number)",
    description: "Absolute value.",
    args: [{ label: "number", type: "number" }],
    returnType: "number",
  },
  {
    name: "ROUND",
    signature: "ROUND(number, digits?)",
    description: "Round a number.",
    args: [
      { label: "number", type: "number" },
      { label: "digits", type: "number" },
    ],
    returnType: "number",
  },
  {
    name: "FLOOR",
    signature: "FLOOR(number)",
    description: "Round down.",
    args: [{ label: "number", type: "number" }],
    returnType: "number",
  },
  { name: "CEIL", signature: "CEIL(number)", description: "Round up.", args: [{ label: "number", type: "number" }], returnType: "number" },
  {
    name: "SQRT",
    signature: "SQRT(number)",
    description: "Square root.",
    args: [{ label: "number", type: "number" }],
    returnType: "number",
  },
  {
    name: "POW",
    signature: "POW(base, exponent)",
    description: "Power.",
    args: [
      { label: "base", type: "number" },
      { label: "exponent", type: "number" },
    ],
    returnType: "number",
  },
  {
    name: "MOD",
    signature: "MOD(a, b)",
    description: "Remainder.",
    args: [
      { label: "a", type: "number" },
      { label: "b", type: "number" },
    ],
    returnType: "number",
  },
  {
    name: "PERCENT",
    signature: "PERCENT(part, total)",
    description: "Part as percent of total.",
    args: [
      { label: "part", type: "number" },
      { label: "total", type: "number" },
    ],
    returnType: "number",
  },
  {
    name: "IF",
    signature: "IF(condition, then, else)",
    description: "Choose by condition.",
    args: [
      { label: "condition", type: "any" },
      { label: "then", type: "any" },
      { label: "else", type: "any" },
    ],
    returnType: "any",
  },
  {
    name: "IFEMPTY",
    signature: "IFEMPTY(value, fallback)",
    description: "Fallback for empty values.",
    args: [
      { label: "value", type: "any" },
      { label: "fallback", type: "any" },
    ],
    returnType: "any",
  },
  {
    name: "IFERROR",
    signature: "IFERROR(value, fallback)",
    description: "Fallback for formula errors.",
    args: [
      { label: "value", type: "any" },
      { label: "fallback", type: "any" },
    ],
    returnType: "any",
  },
  {
    name: "AND",
    signature: "AND(value, ...)",
    description: "All values are truthy.",
    args: [{ label: "value", type: "any" }],
    returnType: "boolean",
  },
  {
    name: "OR",
    signature: "OR(value, ...)",
    description: "Any value is truthy.",
    args: [{ label: "value", type: "any" }],
    returnType: "boolean",
  },
  {
    name: "NOT",
    signature: "NOT(value)",
    description: "Invert truthiness.",
    args: [{ label: "value", type: "any" }],
    returnType: "boolean",
  },
  {
    name: "ISBLANK",
    signature: "ISBLANK(value)",
    description: "True when empty.",
    args: [{ label: "value", type: "any" }],
    returnType: "boolean",
  },
  {
    name: "CONTAINS",
    signature: "CONTAINS(text, search)",
    description: "Substring match.",
    args: [
      { label: "text", type: "text" },
      { label: "search", type: "text" },
    ],
    returnType: "boolean",
  },
  {
    name: "CONCAT",
    signature: "CONCAT(value, ...)",
    description: "Join values as text.",
    args: [{ label: "value", type: "any" }],
    returnType: "text",
  },
  { name: "LEN", signature: "LEN(text)", description: "Text length.", args: [{ label: "text", type: "text" }], returnType: "number" },
  { name: "LOWER", signature: "LOWER(text)", description: "Lowercase text.", args: [{ label: "text", type: "text" }], returnType: "text" },
  { name: "UPPER", signature: "UPPER(text)", description: "Uppercase text.", args: [{ label: "text", type: "text" }], returnType: "text" },
  { name: "TRIM", signature: "TRIM(text)", description: "Trim whitespace.", args: [{ label: "text", type: "text" }], returnType: "text" },
  {
    name: "LEFT",
    signature: "LEFT(text, n)",
    description: "First n characters.",
    args: [
      { label: "text", type: "text" },
      { label: "n", type: "number" },
    ],
    returnType: "text",
  },
  {
    name: "RIGHT",
    signature: "RIGHT(text, n)",
    description: "Last n characters.",
    args: [
      { label: "text", type: "text" },
      { label: "n", type: "number" },
    ],
    returnType: "text",
  },
  {
    name: "SUBSTRING",
    signature: "SUBSTRING(text, start, length)",
    description: "Text slice with 0-based start.",
    args: [
      { label: "text", type: "text" },
      { label: "start", type: "number" },
      { label: "length", type: "number" },
    ],
    returnType: "text",
  },
  {
    name: "REPLACE",
    signature: "REPLACE(text, search, replacement)",
    description: "Replace all matches.",
    args: [
      { label: "text", type: "text" },
      { label: "search", type: "text" },
      { label: "replacement", type: "text" },
    ],
    returnType: "text",
  },
  { name: "TODAY", signature: "TODAY()", description: "Current date.", args: [], returnType: "date" },
  { name: "NOW", signature: "NOW()", description: "Current date and time.", args: [], returnType: "date" },
  { name: "YEAR", signature: "YEAR(date)", description: "Year number.", args: [{ label: "date", type: "date" }], returnType: "number" },
  { name: "MONTH", signature: "MONTH(date)", description: "Month number.", args: [{ label: "date", type: "date" }], returnType: "number" },
  { name: "DAY", signature: "DAY(date)", description: "Day number.", args: [{ label: "date", type: "date" }], returnType: "number" },
  {
    name: "DATEADD",
    signature: 'DATEADD(date, count, "days")',
    description: "Add time to a date.",
    args: [
      { label: "date", type: "date" },
      { label: "count", type: "number" },
      { label: "unit", type: "text" },
    ],
    returnType: "date",
  },
  {
    name: "DATEDIFF",
    signature: 'DATEDIFF(from, to, "days")',
    description: "Difference between dates.",
    args: [
      { label: "from", type: "date" },
      { label: "to", type: "date" },
      { label: "unit", type: "text" },
    ],
    returnType: "number",
  },
];

const FUNCTION_BY_NAME = new Map(GRID_FORMULA_FUNCTIONS.map((fn) => [fn.name, fn]));

const NUMERIC_TYPES = new Set(["number", "percent", "duration", "rollup", "formula"]);
const TEXT_TYPES = new Set(["text", "longtext", "select", "autonumber", "lookup", "formula"]);
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

  return [...fieldSuggestions, ...fnSuggestions].slice(0, 40);
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
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let escaped = false;
      while (j < text.length) {
        const c = text[j]!;
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === quote) {
          j++;
          break;
        }
        j++;
      }
      out += `<span class="str">${escapeHtml(text.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    if (ch === "#") {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9]/.test(text[j]!)) j++;
      out += `<span class="field">${escapeHtml(text.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[0-9]/.test(text[j]!)) j++;
      if (text[j] === "." && /[0-9]/.test(text[j + 1] ?? "")) {
        j++;
        while (j < text.length && /[0-9]/.test(text[j]!)) j++;
      }
      out += `<span class="num">${escapeHtml(text.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j]!)) j++;
      const word = text.slice(i, j);
      out += FUNCTION_BY_NAME.has(word.toUpperCase()) ? `<span class="fn">${escapeHtml(word)}</span>` : escapeHtml(word);
      i = j;
      continue;
    }
    if (/[()+\-*/%,=<>!]/.test(ch)) {
      out += `<span class="op">${escapeHtml(ch)}</span>`;
      i++;
      continue;
    }
    out += escapeHtml(ch);
    i++;
  }
  return out;
};
