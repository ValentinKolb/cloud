import { unquoteIdentifierBody } from "../ref-syntax";
import type { BinOp, Expr, SourceSpan } from "./types";

// ─────────────────────────────────────────────────────────────────
// Tokenizer
// ─────────────────────────────────────────────────────────────────

type RawToken =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ident"; value: string }
  | { kind: "field"; value: string }
  | { kind: "true" }
  | { kind: "false" }
  | { kind: "null" }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" }
  | { kind: "eof" };

type Token = RawToken & { span: SourceSpan };
type ParseFormulaOptions = { scopedRefs?: boolean };

const SINGLE_CHAR_OPS = new Set(["+", "-", "*", "/", "%"]);
const TWO_CHAR_OPS = new Set(["<=", ">=", "!=", "&&", "||"]);
const SINGLE_CHAR_OPERATORS = new Set([...SINGLE_CHAR_OPS, "<", ">", "=", "!"]);
const ESCAPED_STRING_CHARS: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
};

type ScanResult = { token: RawToken; next: number };
type Scanner = (src: string, i: number) => ScanResult | null;

const isWhitespace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean => (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_";
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);
const FIELD_REF_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const isSlugPart = (c: string): boolean => isDigit(c) || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_";

const readDigits = (src: string, i: number): number => {
  let j = i;
  while (j < src.length && isDigit(src[j]!)) j++;
  return j;
};

const readIdentEnd = (src: string, i: number): number => {
  let j = i;
  while (j < src.length && isIdentPart(src[j]!)) j++;
  return j;
};

const readNumberEnd = (src: string, i: number): number => {
  const integerEnd = readDigits(src, i);
  if (src[integerEnd] !== ".") return integerEnd;
  const fractionStart = integerEnd + 1;
  if (fractionStart >= src.length || !isDigit(src[fractionStart]!)) {
    throw new Error(`invalid number literal at offset ${i}`);
  }
  return readDigits(src, fractionStart);
};

const scanNumber: Scanner = (src, i) => {
  if (!isDigit(src[i]!)) return null;
  const j = readNumberEnd(src, i);
  const num = Number(src.slice(i, j));
  if (!Number.isFinite(num)) throw new Error(`invalid number literal at offset ${i}`);
  return { token: { kind: "num", value: num }, next: j };
};

const escapedStringChar = (esc: string | undefined, quote: string): string => {
  if (esc === quote) return quote;
  return esc ? (ESCAPED_STRING_CHARS[esc] ?? esc) : "";
};

const scanString: Scanner = (src, i) => {
  const quote = src[i];
  if (quote !== "'") return null;
  let j = i + 1;
  let value = "";
  while (j < src.length && src[j] !== quote) {
    if (src[j] === "\\" && j + 1 < src.length) {
      value += escapedStringChar(src[j + 1], quote);
      j += 2;
    } else {
      value += src[j];
      j++;
    }
  }
  if (j >= src.length) throw new Error("unterminated string literal");
  return { token: { kind: "str", value }, next: j + 1 };
};

const scanQuotedField: Scanner = (src, i) => {
  if (src[i] !== `"`) return null;
  let j = i + 1;
  let raw = "";
  while (j < src.length) {
    if (src[j] === `"` && src[j + 1] === `"`) {
      raw += `""`;
      j += 2;
      continue;
    }
    if (src[j] === `"`) {
      const value = unquoteIdentifierBody(raw).trim();
      if (!value) throw new Error("empty quoted field reference");
      return { token: { kind: "field", value }, next: j + 1 };
    }
    raw += src[j];
    j++;
  }
  throw new Error("unterminated quoted field reference");
};

const scanBracedField: Scanner = (src, i) => {
  if (src[i] !== "{") return null;
  const j = src.indexOf("}", i + 1);
  if (j === -1) throw new Error("unclosed field reference");
  const value = src.slice(i + 1, j).trim();
  if (value.length === 0) throw new Error("empty field reference");
  if (!FIELD_REF_RE.test(value)) throw new Error("invalid field reference");
  return { token: { kind: "field", value }, next: j + 1 };
};

const readQuotedFieldEnd = (src: string, i: number): number | null => {
  if (src[i] !== `"`) return null;
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === `"` && src[j + 1] === `"`) {
      j++;
      continue;
    }
    if (src[j] === `"`) return j + 1;
  }
  throw new Error("unterminated quoted field reference");
};

const readBracedFieldEnd = (src: string, i: number): number | null => {
  if (src[i] !== "{") return null;
  const end = src.indexOf("}", i + 1);
  if (end === -1) throw new Error("unclosed field reference");
  const value = src.slice(i + 1, end).trim();
  if (value.length === 0) throw new Error("empty field reference");
  if (!FIELD_REF_RE.test(value)) throw new Error("invalid field reference");
  return end + 1;
};

const scanScopedField: Scanner = (src, i) => {
  if (!isIdentStart(src[i]!)) return null;
  const scopeEnd = readIdentEnd(src, i);
  if (src[scopeEnd] !== ".") return null;
  const refStart = scopeEnd + 1;
  let refEnd: number | null = null;
  if (isIdentStart(src[refStart]!)) refEnd = readIdentEnd(src, refStart);
  else refEnd = readQuotedFieldEnd(src, refStart) ?? readBracedFieldEnd(src, refStart);
  if (!refEnd || refEnd === refStart) throw new Error(`invalid scoped field reference at offset ${i}`);
  return { token: { kind: "field", value: src.slice(i, refEnd) }, next: refEnd };
};

const scanSlugField: Scanner = (src, i) => {
  if (src[i] !== "#") return null;
  let j = i + 1;
  while (j < src.length && isSlugPart(src[j]!)) j++;
  if (j === i + 1) throw new Error("empty slug reference after #");
  return { token: { kind: "field", value: src.slice(i + 1, j) }, next: j };
};

const identToken = (ident: string): RawToken => {
  const upper = ident.toUpperCase();
  if (upper === "TRUE") return { kind: "true" };
  if (upper === "FALSE") return { kind: "false" };
  if (upper === "NULL") return { kind: "null" };
  return { kind: "ident", value: ident };
};

const scanIdentifier: Scanner = (src, i) => {
  if (!isIdentStart(src[i]!)) return null;
  const j = readIdentEnd(src, i);
  return { token: identToken(src.slice(i, j)), next: j };
};

const scanPunctuation: Scanner = (src, i) => {
  if (src[i] === "(") return { token: { kind: "lparen" }, next: i + 1 };
  if (src[i] === ")") return { token: { kind: "rparen" }, next: i + 1 };
  if (src[i] === ",") return { token: { kind: "comma" }, next: i + 1 };
  return null;
};

const scanOperator: Scanner = (src, i) => {
  const c = src[i]!;
  const two = src.slice(i, i + 2);
  if (TWO_CHAR_OPS.has(two)) return { token: { kind: "op", value: two }, next: i + 2 };
  if (SINGLE_CHAR_OPERATORS.has(c)) return { token: { kind: "op", value: c }, next: i + 1 };
  return null;
};

const SCANNERS: Scanner[] = [
  scanNumber,
  scanString,
  scanQuotedField,
  scanBracedField,
  scanSlugField,
  scanIdentifier,
  scanPunctuation,
  scanOperator,
];

const SCOPED_SCANNERS: Scanner[] = [
  scanNumber,
  scanString,
  scanQuotedField,
  scanBracedField,
  scanSlugField,
  scanScopedField,
  scanIdentifier,
  scanPunctuation,
  scanOperator,
];

const scanToken = (src: string, i: number, options: ParseFormulaOptions = {}): ScanResult => {
  for (const scanner of options.scopedRefs ? SCOPED_SCANNERS : SCANNERS) {
    const result = scanner(src, i);
    if (result) return result;
  }
  throw new Error(`unexpected character "${src[i]}" at position ${i}`);
};

const tokenize = (src: string, offset = 0, options: ParseFormulaOptions = {}): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (isWhitespace(c)) {
      i++;
      continue;
    }
    const result = scanToken(src, i, options);
    tokens.push({ ...result.token, span: { start: offset + i, end: offset + result.next } } as Token);
    i = result.next;
  }
  tokens.push({ kind: "eof", span: { start: offset + src.length, end: offset + src.length } });
  return tokens;
};

// ─────────────────────────────────────────────────────────────────
// Pratt parser
// ─────────────────────────────────────────────────────────────────

const BINDING: Record<string, [number, number]> = {
  "||": [10, 11],
  "&&": [20, 21],
  "=": [30, 31],
  "!=": [30, 31],
  "<": [40, 41],
  "<=": [40, 41],
  ">": [40, 41],
  ">=": [40, 41],
  "+": [50, 51],
  "-": [50, 51],
  "*": [60, 61],
  "/": [60, 61],
  "%": [60, 61],
};

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  peek(): Token {
    return this.tokens[this.pos]!;
  }
  next(): Token {
    return this.tokens[this.pos++]!;
  }

  private peekNext(): Token {
    return this.tokens[this.pos + 1]!;
  }

  private binaryOpFor(token: Token): BinOp | null {
    if (token.kind === "op" && BINDING[token.value]) return token.value as BinOp;
    if (token.kind !== "ident") return null;
    const lower = token.value.toLowerCase();
    if (lower === "and") return "&&";
    if (lower === "or") return "||";
    return null;
  }

  parseExpr(minBp = 0): Expr {
    let left = this.parsePrefix();
    while (true) {
      const t = this.peek();
      const op = this.binaryOpFor(t);
      if (!op) break;
      const bp = BINDING[op];
      if (!bp) break;
      if (bp[0] < minBp) break;
      this.next();
      const right = this.parseExpr(bp[1]);
      left = withSpan({ kind: "binop", op, left, right }, mergeSpans(left.span, right.span));
    }
    return left;
  }

  parsePrefix(): Expr {
    const t = this.next();
    switch (t.kind) {
      case "num":
        return withSpan({ kind: "literal", value: t.value }, t.span);
      case "str":
        return withSpan({ kind: "literal", value: t.value }, t.span);
      case "true":
        return withSpan({ kind: "literal", value: true }, t.span);
      case "false":
        return withSpan({ kind: "literal", value: false }, t.span);
      case "null":
        return withSpan({ kind: "literal", value: null }, t.span);
      case "field":
        return withSpan({ kind: "field", fieldId: t.value }, t.span);
      case "lparen": {
        const inner = this.parseExpr(0);
        if (this.peek().kind !== "rparen") throw new Error("expected ')'");
        const rparen = this.next();
        return withSpan(inner, { start: t.span.start, end: rparen.span.end });
      }
      case "op":
        if (t.value === "-") {
          const operand = this.parseExpr(70);
          return withSpan({ kind: "unop", op: "-", operand }, mergeSpans(t.span, operand.span));
        }
        if (t.value === "!") {
          const operand = this.parseExpr(70);
          return withSpan({ kind: "unop", op: "!", operand }, mergeSpans(t.span, operand.span));
        }
        throw new Error(`unexpected operator ${t.value}`);
      case "ident": {
        if (t.value.toLowerCase() === "not" && (this.peek().kind !== "lparen" || this.peek().span.start > t.span.end)) {
          const operand = this.parseExpr(70);
          return withSpan({ kind: "unop", op: "!", operand }, mergeSpans(t.span, operand.span));
        }
        if (this.peek().kind !== "lparen") {
          return withSpan({ kind: "field", fieldId: t.value }, t.span);
        }
        this.next(); // (
        const args: Expr[] = [];
        if (this.peek().kind !== "rparen") {
          args.push(this.parseExpr(0));
          while (this.peek().kind === "comma") {
            this.next();
            args.push(this.parseExpr(0));
          }
        }
        if (this.peek().kind !== "rparen") throw new Error("expected ')'");
        const rparen = this.next();
        return withSpan({ kind: "call", fn: t.value.toUpperCase(), args }, { start: t.span.start, end: rparen.span.end });
      }
      default:
        throw new Error(`unexpected token ${t.kind}`);
    }
  }
}

const withSpan = <T extends Expr>(expr: T, span: SourceSpan | undefined): T => {
  if (!span) return expr;
  Object.defineProperty(expr, "span", {
    value: span,
    enumerable: false,
    configurable: true,
  });
  return expr;
};

const mergeSpans = (a: SourceSpan | undefined, b: SourceSpan | undefined): SourceSpan | undefined =>
  a && b ? { start: a.start, end: b.end } : (a ?? b);

type ParseResult = { ok: true; ast: Expr } | { ok: false; error: string };

const normalizeFormulaSource = (source: string): { source: string; offset: number } => {
  const trimmed = source.trim();
  if (!trimmed.startsWith("=")) return { source, offset: 0 };
  const leadingWhitespace = source.length - source.trimStart().length;
  const afterEquals = source.slice(leadingWhitespace + 1);
  const formulaWhitespace = afterEquals.length - afterEquals.trimStart().length;
  return {
    source: afterEquals.trimStart(),
    offset: leadingWhitespace + 1 + formulaWhitespace,
  };
};

export const parseFormula = (source: string, options: ParseFormulaOptions = {}): ParseResult => {
  try {
    const normalized = normalizeFormulaSource(source);
    const tokens = tokenize(normalized.source, normalized.offset, options);
    const parser = new Parser(tokens);
    const ast = parser.parseExpr(0);
    if (parser.peek().kind !== "eof") {
      return { ok: false, error: "trailing tokens after expression" };
    }
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/** Recursively collects every fieldId referenced by an AST. Used for
 *  cycle detection at save-time. */
export const collectFieldRefs = (ast: Expr, out: Set<string> = new Set()): Set<string> => {
  switch (ast.kind) {
    case "field":
      out.add(ast.fieldId);
      return out;
    case "binop":
      collectFieldRefs(ast.left, out);
      collectFieldRefs(ast.right, out);
      return out;
    case "unop":
      collectFieldRefs(ast.operand, out);
      return out;
    case "call":
      for (const a of ast.args) collectFieldRefs(a, out);
      return out;
    default:
      return out;
  }
};
