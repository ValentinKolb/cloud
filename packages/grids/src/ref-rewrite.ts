import { formatIdentifierRef, normalizeRefKey, unquoteIdentifierBody } from "./ref-syntax";
import { parseFormula } from "./formula/parser";
import type { Expr, SourceSpan } from "./formula/types";

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

const readSingleQuotedStringEnd = (input: string, start: number): number => {
  for (let i = start + 1; i < input.length; i++) {
    if (input[i] === "\\" && i + 1 < input.length) {
      i++;
      continue;
    }
    if (input[i] === "'") return i + 1;
  }
  return input.length;
};

const readDoubleQuotedIdentifierEnd = (input: string, start: number): number => {
  for (let i = start + 1; i < input.length; i++) {
    if (input[i] === `"` && input[i + 1] === `"`) {
      i++;
      continue;
    }
    if (input[i] === `"`) return i + 1;
  }
  return input.length;
};

const readBareIdentifierEnd = (input: string, start: number): number => {
  let end = start + 1;
  while (end < input.length && IDENT_PART.test(input[end]!)) end++;
  return end;
};

const nextNonWhitespace = (input: string, start: number): string | null => {
  for (let i = start; i < input.length; i++) {
    const c = input[i]!;
    if (!/\s/.test(c)) return c;
  }
  return null;
};

export const rewriteIdentifierRefs = (
  input: string,
  rename: { oldName: string; newName: string },
): { text: string; changed: boolean } => {
  const oldKey = normalizeRefKey(rename.oldName);
  const replacement = formatIdentifierRef(rename.newName);
  let out = "";
  let changed = false;

  for (let i = 0; i < input.length;) {
    const c = input[i]!;

    if (c === "'") {
      const end = readSingleQuotedStringEnd(input, i);
      out += input.slice(i, end);
      i = end;
      continue;
    }

    if (c === `"`) {
      const end = readDoubleQuotedIdentifierEnd(input, i);
      const raw = input.slice(i, end);
      const value = end <= input.length && raw.endsWith(`"`) ? unquoteIdentifierBody(raw.slice(1, -1)) : null;
      if (value && normalizeRefKey(value) === oldKey) {
        out += replacement;
        changed = true;
      } else {
        out += raw;
      }
      i = end;
      continue;
    }

    if (IDENT_START.test(c)) {
      const end = readBareIdentifierEnd(input, i);
      const value = input.slice(i, end);
      if (normalizeRefKey(value) === oldKey && nextNonWhitespace(input, end) !== "(") {
        out += replacement;
        changed = true;
      } else {
        out += value;
      }
      i = end;
      continue;
    }

    out += c;
    i++;
  }

  return { text: out, changed };
};

const collectFieldSpans = (expr: Expr, oldKey: string, out: SourceSpan[] = []): SourceSpan[] => {
  switch (expr.kind) {
    case "field":
      if (expr.span && normalizeRefKey(expr.fieldId) === oldKey) out.push(expr.span);
      return out;
    case "binop":
      collectFieldSpans(expr.left, oldKey, out);
      collectFieldSpans(expr.right, oldKey, out);
      return out;
    case "unop":
      collectFieldSpans(expr.operand, oldKey, out);
      return out;
    case "call":
      for (const arg of expr.args) collectFieldSpans(arg, oldKey, out);
      return out;
    default:
      return out;
  }
};

const applySpanReplacements = (input: string, spans: SourceSpan[], replacement: string): string => {
  let text = input;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    text = `${text.slice(0, span.start)}${replacement}${text.slice(span.end)}`;
  }
  return text;
};

export const rewriteFormulaIdentifierRefs = (
  input: string,
  rename: { oldName: string; newName: string },
): { text: string; changed: boolean } => {
  const parsed = parseFormula(input);
  if (!parsed.ok) return rewriteIdentifierRefs(input, rename);
  const spans = collectFieldSpans(parsed.ast, normalizeRefKey(rename.oldName));
  if (spans.length === 0) return { text: input, changed: false };
  return { text: applySpanReplacements(input, spans, formatIdentifierRef(rename.newName)), changed: true };
};
