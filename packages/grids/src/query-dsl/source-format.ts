import type { Literal } from "../formula/types";

export type GqlSourceKind = "table" | "view";

const GQL_ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const GQL_RESERVED_ALIASES = new Set([
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

export const gqlAliasKey = (value: string): string => value.toLowerCase();

export const isGqlAlias = (value: string): boolean => GQL_ALIAS_RE.test(value) && !GQL_RESERVED_ALIASES.has(gqlAliasKey(value));

export const gqlFieldRef = (fieldId: string): string => `{${fieldId}}`;

export const gqlSourceRef = (kind: GqlSourceKind, id: string): string => `${kind} {${id}}`;

export const gqlQuotedRef = (value: string): string => `"${value.replaceAll('"', '""')}"`;

export const gqlStringLiteral = (value: string): string =>
  `'${value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t").replaceAll("'", "\\'")}'`;

export const gqlLiteralSource = (value: Literal): string => {
  if (value === null) return "null";
  if (typeof value === "string") return gqlStringLiteral(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return Number.isFinite(value) ? String(value) : "null";
};

export const gqlLiteralFromUnknown = (value: unknown): string | null => {
  if (value === null) return "null";
  if (typeof value === "string") return gqlStringLiteral(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
};

export const gqlLiteralListFromUnknown = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const values = value.map(gqlLiteralFromUnknown);
  return values.every((item): item is string => item !== null) ? values : null;
};
