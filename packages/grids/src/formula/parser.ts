import type { Expr, BinOp } from "./types";

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

const tokenize = (src: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    // numbers — strict decimal grammar `\d+(\.\d+)?`. Previous lazy
    // consumer (run of digits and dots) accepted "1..2" and produced
    // Number("1..2") = NaN, which then renderResult happily passed
    // through as a numeric value (chunk 6 important). The strict
    // shape rejects malformed inputs at parse time. parseFormula's
    // outer try/catch turns these throws into clean ParseResult.fail.
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && src[j]! >= "0" && src[j]! <= "9") j++;
      if (j < n && src[j] === ".") {
        // Decimal portion: at least one digit must follow the dot.
        // Reject "1." or "1..2" — better error here than NaN at eval.
        if (j + 1 >= n || src[j + 1]! < "0" || src[j + 1]! > "9") {
          throw new Error(`invalid number literal at offset ${i}`);
        }
        j++;
        while (j < n && src[j]! >= "0" && src[j]! <= "9") j++;
      }
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) {
        throw new Error(`invalid number literal at offset ${i}`);
      }
      tokens.push({ kind: "num", value: num });
      i = j;
      continue;
    }
    // strings (single or double quotes)
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < n) {
          const esc = src[j + 1];
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else if (esc === "r") value += "\r";
          else if (esc === "\\") value += "\\";
          else if (esc === quote) value += quote;
          else value += src[j + 1];
          j += 2;
        } else {
          value += src[j];
          j++;
        }
      }
      if (j >= n) throw new Error("unterminated string literal");
      tokens.push({ kind: "str", value });
      i = j + 1;
      continue;
    }
    // field reference — two equivalent syntaxes:
    //   {fieldId}  legacy / explicit form (still parsed; UUID inside)
    //   #slug      preferred short form (matches the field's 5-char slug)
    // Both emit the same `field` token. The evaluator resolves the
    // value by trying its UUID map first, then its slug map — slugs and
    // UUIDs can't collide (UUIDs are 36 chars with hyphens, slugs are
    // 5 chars of alphanumeric).
    if (c === "{") {
      const j = src.indexOf("}", i + 1);
      if (j === -1) throw new Error("unclosed field reference");
      const value = src.slice(i + 1, j).trim();
      if (value.length === 0) throw new Error("empty field reference");
      tokens.push({ kind: "field", value });
      i = j + 1;
      continue;
    }
    if (c === "#") {
      let j = i + 1;
      while (j < n) {
        const k = src[j]!;
        if ((k >= "a" && k <= "z") || (k >= "A" && k <= "Z") || (k >= "0" && k <= "9")) {
          j++;
        } else break;
      }
      if (j === i + 1) throw new Error("empty slug reference after #");
      const value = src.slice(i + 1, j);
      tokens.push({ kind: "field", value });
      i = j;
      continue;
    }
    // identifier (function name) or boolean literal
    if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_") {
      let j = i + 1;
      while (j < n) {
        const ch = src[j]!;
        if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "_") j++;
        else break;
      }
      const ident = src.slice(i, j);
      const upper = ident.toUpperCase();
      if (upper === "TRUE") tokens.push({ kind: "true" });
      else if (upper === "FALSE") tokens.push({ kind: "false" });
      else if (upper === "NULL") tokens.push({ kind: "null" });
      else tokens.push({ kind: "ident", value: ident });
      i = j;
      continue;
    }
    // punctuation
    if (c === "(") { tokens.push({ kind: "lparen" }); i++; continue; }
    if (c === ")") { tokens.push({ kind: "rparen" }); i++; continue; }
    if (c === ",") { tokens.push({ kind: "comma" }); i++; continue; }
    // operators
    if (c === "<" || c === ">" || c === "=" || c === "!") {
      if (src[i + 1] === "=") {
        tokens.push({ kind: "op", value: c + "=" });
        i += 2;
        continue;
      }
      // Bare `!` is unary NOT — the parser's prefix branch handles it.
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    if (c === "&" && src[i + 1] === "&") { tokens.push({ kind: "op", value: "&&" }); i += 2; continue; }
    if (c === "|" && src[i + 1] === "|") { tokens.push({ kind: "op", value: "||" }); i += 2; continue; }
    if (SINGLE_CHAR_OPS.has(c)) { tokens.push({ kind: "op", value: c }); i++; continue; }
    throw new Error(`unexpected character "${c}" at position ${i}`);
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
  "=": [30, 31], "!=": [30, 31],
  "<": [40, 41], "<=": [40, 41], ">": [40, 41], ">=": [40, 41],
  "+": [50, 51], "-": [50, 51],
  "*": [60, 61], "/": [60, 61], "%": [60, 61],
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
      case "num": return { kind: "literal", value: t.value };
      case "str": return { kind: "literal", value: t.value };
      case "true": return { kind: "literal", value: true };
      case "false": return { kind: "literal", value: false };
      case "null": return { kind: "literal", value: null };
      case "field": return { kind: "field", fieldId: t.value };
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

export type ParseResult = { ok: true; ast: Expr } | { ok: false; error: string };

export const parseFormula = (source: string): ParseResult => {
  try {
    const tokens = tokenize(source);
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
