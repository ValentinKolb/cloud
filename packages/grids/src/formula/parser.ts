import type { BinOp, Expr } from "./types";

// ─────────────────────────────────────────────────────────────────
// Tokenizer
// ─────────────────────────────────────────────────────────────────

type Token =
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

const SINGLE_CHAR_OPS = new Set(["+", "-", "*", "/", "%"]);
const TWO_CHAR_OPS = new Set(["<=", ">=", "!=", "&&", "||"]);
const SINGLE_CHAR_OPERATORS = new Set([...SINGLE_CHAR_OPS, "<", ">", "=", "!"]);
const ESCAPED_STRING_CHARS: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
};

type ScanResult = { token: Token; next: number };
type Scanner = (src: string, i: number) => ScanResult | null;

const isWhitespace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean => (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_";
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);
const isSlugPart = (c: string): boolean => isDigit(c) || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");

const readDigits = (src: string, i: number): number => {
  let j = i;
  while (j < src.length && isDigit(src[j]!)) j++;
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
  if (quote !== '"' && quote !== "'") return null;
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

const scanBracedField: Scanner = (src, i) => {
  if (src[i] !== "{") return null;
  const j = src.indexOf("}", i + 1);
  if (j === -1) throw new Error("unclosed field reference");
  const value = src.slice(i + 1, j).trim();
  if (value.length === 0) throw new Error("empty field reference");
  return { token: { kind: "field", value }, next: j + 1 };
};

const scanSlugField: Scanner = (src, i) => {
  if (src[i] !== "#") return null;
  let j = i + 1;
  while (j < src.length && isSlugPart(src[j]!)) j++;
  if (j === i + 1) throw new Error("empty slug reference after #");
  return { token: { kind: "field", value: src.slice(i + 1, j) }, next: j };
};

const identToken = (ident: string): Token => {
  const upper = ident.toUpperCase();
  if (upper === "TRUE") return { kind: "true" };
  if (upper === "FALSE") return { kind: "false" };
  if (upper === "NULL") return { kind: "null" };
  return { kind: "ident", value: ident };
};

const scanIdentifier: Scanner = (src, i) => {
  if (!isIdentStart(src[i]!)) return null;
  let j = i + 1;
  while (j < src.length && isIdentPart(src[j]!)) j++;
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
  scanBracedField,
  scanSlugField,
  scanIdentifier,
  scanPunctuation,
  scanOperator,
];

const scanToken = (src: string, i: number): ScanResult => {
  for (const scanner of SCANNERS) {
    const result = scanner(src, i);
    if (result) return result;
  }
  throw new Error(`unexpected character "${src[i]}" at position ${i}`);
};

const tokenize = (src: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (isWhitespace(c)) {
      i++;
      continue;
    }
    const result = scanToken(src, i);
    tokens.push(result.token);
    i = result.next;
  }
  tokens.push({ kind: "eof" });
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

  parseExpr(minBp = 0): Expr {
    let left = this.parsePrefix();
    while (true) {
      const t = this.peek();
      if (t.kind !== "op") break;
      const bp = BINDING[t.value];
      if (!bp) break;
      if (bp[0] < minBp) break;
      this.next();
      const right = this.parseExpr(bp[1]);
      left = { kind: "binop", op: t.value as BinOp, left, right };
    }
    return left;
  }

  parsePrefix(): Expr {
    const t = this.next();
    switch (t.kind) {
      case "num":
        return { kind: "literal", value: t.value };
      case "str":
        return { kind: "literal", value: t.value };
      case "true":
        return { kind: "literal", value: true };
      case "false":
        return { kind: "literal", value: false };
      case "null":
        return { kind: "literal", value: null };
      case "field":
        return { kind: "field", fieldId: t.value };
      case "lparen": {
        const inner = this.parseExpr(0);
        if (this.peek().kind !== "rparen") throw new Error("expected ')'");
        this.next();
        return inner;
      }
      case "op":
        if (t.value === "-") {
          const operand = this.parseExpr(70);
          return { kind: "unop", op: "-", operand };
        }
        if (t.value === "!") {
          const operand = this.parseExpr(70);
          return { kind: "unop", op: "!", operand };
        }
        throw new Error(`unexpected operator ${t.value}`);
      case "ident": {
        if (this.peek().kind !== "lparen") {
          throw new Error(`identifier ${t.value} must be a function call (use parens)`);
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
        this.next();
        return { kind: "call", fn: t.value.toUpperCase(), args };
      }
      default:
        throw new Error(`unexpected token ${t.kind}`);
    }
  }
}

type ParseResult = { ok: true; ast: Expr } | { ok: false; error: string };

const normalizeFormulaSource = (source: string): string => {
  const trimmed = source.trim();
  return trimmed.startsWith("=") ? trimmed.slice(1).trimStart() : source;
};

export const parseFormula = (source: string): ParseResult => {
  try {
    const tokens = tokenize(normalizeFormulaSource(source));
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
