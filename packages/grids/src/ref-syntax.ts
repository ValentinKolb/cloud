const SIMPLE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IDENTIFIER_REF_MAX_LENGTH = 200;

export const QUERY_RESERVED_WORDS = new Set([
  "aggregate",
  "and",
  "as",
  "asc",
  "ascending",
  "by",
  "deleted",
  "desc",
  "descending",
  "false",
  "formula",
  "from",
  "group",
  "having",
  "include",
  "join",
  "left",
  "limit",
  "not",
  "null",
  "nulls",
  "offset",
  "on",
  "only",
  "or",
  "search",
  "select",
  "skip",
  "sort",
  "table",
  "true",
  "view",
  "where",
]);

export const normalizeRefKey = (value: string): string => value.trim().toLowerCase();

const isSafeBareIdentifier = (value: string): boolean => SIMPLE_IDENTIFIER_RE.test(value) && !QUERY_RESERVED_WORDS.has(value.toLowerCase());

const quoteIdentifier = (value: string): string => `"${value.replaceAll(`"`, `""`)}"`;

export const formatIdentifierRef = (value: string): string => (isSafeBareIdentifier(value) ? value : quoteIdentifier(value));

export const unquoteIdentifierBody = (body: string): string => body.replaceAll(`""`, `"`);

const readQuotedIdentifier = (input: string, start: number): { value: string; end: number } | null => {
  if (input[start] !== `"`) return null;
  let out = "";
  for (let i = start + 1; i < input.length; i++) {
    const c = input[i]!;
    if (c === `"`) {
      if (input[i + 1] === `"`) {
        out += `"`;
        i++;
        continue;
      }
      return { value: out, end: i + 1 };
    }
    out += c;
  }
  return null;
};

const readBareIdentifier = (input: string, start: number): { value: string; end: number } | null => {
  const first = input[start];
  if (!first || !/[A-Za-z_]/.test(first)) return null;
  let end = start + 1;
  while (end < input.length && /[A-Za-z0-9_]/.test(input[end]!)) end++;
  return { value: input.slice(start, end), end };
};

const readBracedIdentifier = (input: string, start: number): { value: string; end: number } | null => {
  if (input[start] !== "{") return null;
  const end = input.indexOf("}", start + 1);
  if (end === -1) return null;
  const value = input.slice(start + 1, end).trim();
  if (!value || value.length > IDENTIFIER_REF_MAX_LENGTH) return null;
  return { value, end: end + 1 };
};

export const parseIdentifierRef = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const braced = readBracedIdentifier(trimmed, 0);
  if (braced && braced.end === trimmed.length) return braced.value;
  const quoted = readQuotedIdentifier(trimmed, 0);
  if (quoted && quoted.end === trimmed.length && quoted.value.trim() && quoted.value.length <= IDENTIFIER_REF_MAX_LENGTH)
    return quoted.value;
  const bare = readBareIdentifier(trimmed, 0);
  if (bare && bare.end === trimmed.length && bare.value.length <= IDENTIFIER_REF_MAX_LENGTH) return bare.value;
  return null;
};

type QualifiedIdentifierRef = {
  scope?: string;
  ref: string;
};

export const parseQualifiedIdentifierRef = (input: string): QualifiedIdentifierRef | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let quote = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]!;
    if (quote) {
      if (c === `"` && trimmed[i + 1] === `"`) {
        i++;
        continue;
      }
      if (c === `"`) quote = false;
      continue;
    }
    if (c === `"`) {
      quote = true;
      continue;
    }
    if (c !== ".") continue;
    const scope = parseIdentifierRef(trimmed.slice(0, i));
    const ref = parseIdentifierRef(trimmed.slice(i + 1));
    if (!scope || !ref || !SIMPLE_IDENTIFIER_RE.test(scope)) return null;
    return { scope, ref };
  }

  const ref = parseIdentifierRef(trimmed);
  return ref ? { ref } : null;
};

export const splitTrailingKeywordOutsideQuotes = (input: string, keyword: string): [string, string] | null => {
  const lowerKeyword = keyword.toLowerCase();
  let quote: string | null = null;
  let depth = 0;
  let last: number | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote) {
      if (quote === `"` && c === `"` && input[i + 1] === `"`) {
        i++;
        continue;
      }
      if (quote !== `"` && c === "\\" && i + 1 < input.length) {
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
    if (c === "(") depth++;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    const beforeOk = i === 0 || /\s/.test(input[i - 1]!);
    const afterIndex = i + keyword.length;
    const afterOk = afterIndex >= input.length || /\s/.test(input[afterIndex]!);
    if (beforeOk && afterOk && input.slice(i, afterIndex).toLowerCase() === lowerKeyword) last = i;
  }
  if (last === null) return null;
  return [input.slice(0, last).trim(), input.slice(last + keyword.length).trim()];
};
