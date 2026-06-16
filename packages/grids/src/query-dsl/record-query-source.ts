import type { RecordMetaQuery, SearchSpec, SortSpec, RecordQuery } from "../contracts";

const fieldRef = (fieldId: string) => `{${fieldId}}`;
const computedRef = (expression: string) => `formula(${expression.trim()})`;
const ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const RESERVED_ALIASES = new Set([
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

const literal = (value: unknown): string | null => {
  if (value === null) return "null";
  if (typeof value === "string")
    return `'${value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t").replaceAll("'", "\\'")}'`;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
};

const listLiterals = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const values = value.map(literal);
  return values.every((item): item is string => item !== null) ? values : null;
};

type ConvertResult = { ok: true; source: string } | { ok: false; reason: string };

const unsupported = (reason: string): ConvertResult => ({ ok: false, reason });

const validAlias = (value: string): boolean => ALIAS_RE.test(value) && !RESERVED_ALIASES.has(value.toLowerCase());

const recordMetaRef = (key: "createdBy" | "updatedBy" | "deletedBy") => `record.${key}`;

const recordSortRef = (key: "createdAt" | "updatedAt" | "deletedAt") => `record.${key}`;

const recordMetaToGqlWhere = (meta: RecordMetaQuery | undefined): ConvertResult | undefined => {
  const parts: string[] = [];
  for (const key of ["createdBy", "updatedBy", "deletedBy"] as const) {
    const ids = [...new Set(meta?.users?.[key] ?? [])].filter(Boolean);
    if (ids.length === 0) continue;
    const values = ids.map(literal);
    if (!values.every((item): item is string => item !== null)) return unsupported(`record.${key} needs literal user ids`);
    parts.push(values.length === 1 ? `${recordMetaRef(key)} = ${values[0]}` : `oneof(${recordMetaRef(key)}, ${values.join(", ")})`);
  }
  return parts.length > 0 ? { ok: true, source: parts.length === 1 ? parts[0]! : `(${parts.join(" and ")})` } : undefined;
};

const filterLeafToGql = (leaf: { fieldId: string; op: string; value?: unknown; caseInsensitive?: boolean }): ConvertResult => {
  const ref = fieldRef(leaf.fieldId);
  if (leaf.op === "isEmpty") return { ok: true, source: `${ref} = null` };
  if (leaf.op === "isNotEmpty") return { ok: true, source: `${ref} != null` };

  if (leaf.op === "containsAny" || leaf.op === "notContainsAny" || leaf.op === "isAnyOf" || leaf.op === "isNoneOf") {
    const values = listLiterals(leaf.value);
    if (!values) return unsupported(`operator ${leaf.op} needs at least one literal value`);
    const fn = leaf.op === "notContainsAny" || leaf.op === "isNoneOf" ? "noneof" : "oneof";
    return { ok: true, source: `${fn}(${ref}, ${values.join(", ")})` };
  }

  if (leaf.op === "is" || leaf.op === "isNot") {
    const value = literal(leaf.value);
    if (value === null) return unsupported(`operator ${leaf.op} needs a literal value`);
    return { ok: true, source: `${ref} ${leaf.op === "is" ? "=" : "!="} ${value}` };
  }

  if (["=", "!=", "<", "<=", ">", ">=", "equals", "notEquals", "before", "after", "onOrBefore", "onOrAfter"].includes(leaf.op)) {
    const value = literal(leaf.value);
    if (value === null) return unsupported(`operator ${leaf.op} needs a literal value`);
    const op =
      leaf.op === "equals"
        ? "="
        : leaf.op === "notEquals"
          ? "!="
          : leaf.op === "before"
            ? "<"
            : leaf.op === "after"
              ? ">"
              : leaf.op === "onOrBefore"
                ? "<="
                : leaf.op === "onOrAfter"
                  ? ">="
                  : leaf.op;
    return { ok: true, source: `${ref} ${op} ${value}` };
  }

  if (leaf.op === "between") {
    if (!Array.isArray(leaf.value) || leaf.value.length !== 2) return unsupported("between needs exactly two literal values");
    const lower = literal(leaf.value[0]);
    const upper = literal(leaf.value[1]);
    if (lower === null || upper === null) return unsupported("between bounds must be literals");
    return { ok: true, source: `(${ref} >= ${lower} and ${ref} <= ${upper})` };
  }

  if (leaf.op === "contains" || leaf.op === "startsWith" || leaf.op === "endsWith") {
    const value = literal(leaf.value);
    if (value === null) return unsupported(`operator ${leaf.op} needs a text value`);
    const fn =
      leaf.caseInsensitive && leaf.op === "contains"
        ? "icontains"
        : leaf.caseInsensitive && leaf.op === "startsWith"
          ? "istartswith"
          : leaf.caseInsensitive && leaf.op === "endsWith"
            ? "iendswith"
            : leaf.op === "startsWith"
              ? "startswith"
              : leaf.op === "endsWith"
                ? "endswith"
                : "contains";
    return { ok: true, source: `${fn}(${ref}, ${value})` };
  }

  if (leaf.op === "notContains") {
    const value = literal(leaf.value);
    if (value === null) return unsupported("notContains needs a text value");
    return { ok: true, source: `not contains(${ref}, ${value})` };
  }

  if (leaf.op === "today") return { ok: true, source: `${ref} = TODAY()` };
  if (leaf.op === "lastNDays") {
    const value = literal(typeof leaf.value === "number" ? -leaf.value : null);
    if (value === null) return unsupported("lastNDays needs a number");
    return { ok: true, source: `${ref} >= DATEADD(TODAY(), ${value}, 'days')` };
  }

  return unsupported(`operator ${leaf.op} is only available in direct GQL`);
};

export const filterToGqlWhere = (filter: RecordQuery["filter"]): ConvertResult | undefined => {
  if (!filter) return undefined;
  if ("filters" in filter && Array.isArray((filter as { filters?: unknown }).filters)) {
    const group = filter as { op: "AND" | "OR"; filters: NonNullable<RecordQuery["filter"]>[] };
    if (group.filters.length === 0) return undefined;
    const parts: string[] = [];
    for (const item of group.filters) {
      const converted = filterToGqlWhere(item);
      if (!converted) continue;
      if (!converted.ok) return converted;
      parts.push(converted.source);
    }
    if (parts.length === 0) return undefined;
    const joiner = group.op === "OR" ? " or " : " and ";
    return { ok: true, source: parts.length === 1 ? parts[0]! : `(${parts.join(joiner)})` };
  }
  return filterLeafToGql(filter as { fieldId: string; op: string; value?: unknown; caseInsensitive?: boolean });
};

const sortTarget = (sort: SortSpec): string | null => ("fieldId" in sort ? fieldRef(sort.fieldId) : recordSortRef(sort.key));

export const sortToGql = (sort: RecordQuery["sort"]): ConvertResult | undefined => {
  if (!sort || sort.length === 0) return undefined;
  const parts: string[] = [];
  for (const item of sort) {
    const target = sortTarget(item);
    if (!target) return unsupported("record metadata sorting is only available in direct GQL for now");
    const nulls = item.nullsFirst === undefined ? "" : item.nullsFirst ? " nulls first" : " nulls last";
    parts.push(`${target} ${item.direction ?? "asc"}${nulls}`);
  }
  return { ok: true, source: parts.join(", ") };
};

const columnsToGql = (columns: RecordQuery["columns"]): ConvertResult | undefined => {
  if (!columns || columns.length === 0) return undefined;
  const parts: string[] = [];
  for (const column of columns) {
    if (!("fieldId" in column)) {
      const alias = column.label.trim();
      if (!validAlias(alias)) return unsupported(`computed column label "${column.label}" is not a valid GQL alias`);
      parts.push(`${computedRef(column.expression)} as ${alias}`);
      continue;
    }
    parts.push(fieldRef(column.fieldId));
  }
  return { ok: true, source: parts.join(", ") };
};

const groupByToGql = (groupBy: RecordQuery["groupBy"]): ConvertResult | undefined => {
  if (!groupBy || groupBy.length === 0) return undefined;
  const parts = groupBy.map((group) => `${fieldRef(group.fieldId)}${group.granularity ? ` by ${group.granularity}` : ""}`);
  return { ok: true, source: parts.join(", ") };
};

const aggregationAlias = (aggregation: NonNullable<RecordQuery["aggregations"]>[number]): ConvertResult => {
  const label =
    aggregation.label?.trim() ??
    (aggregation.fieldId === "*" && aggregation.agg === "count" ? "rows" : `${aggregation.agg}_${aggregation.fieldId.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 24)}`);
  if (!validAlias(label)) return unsupported(`aggregation label "${label}" is not a valid GQL alias`);
  return { ok: true, source: label };
};

const aggregationsToGql = (aggregations: RecordQuery["aggregations"]): ConvertResult | undefined => {
  if (!aggregations || aggregations.length === 0) return undefined;
  const parts: string[] = [];
  for (const aggregation of aggregations) {
    const alias = aggregationAlias(aggregation);
    if (!alias.ok) return alias;
    const arg = aggregation.fieldId === "*" ? "*" : fieldRef(aggregation.fieldId);
    parts.push(`${aggregation.agg}(${arg}) as ${alias.source}`);
  }
  return { ok: true, source: parts.join(", ") };
};

const groupedSortToGql = (query: RecordQuery): ConvertResult | undefined => {
  const parts: string[] = [];
  for (const item of query.groupSort ?? []) {
    const match = (query.aggregations ?? []).find((aggregation) => aggregation.fieldId === item.fieldId && aggregation.agg === item.agg);
    if (!match) return unsupported(`group sort ${item.agg}(${item.fieldId}) needs a matching aggregation`);
    const alias = aggregationAlias(match);
    if (!alias.ok) return alias;
    parts.push(`${alias.source} ${item.direction ?? "asc"}`);
  }
  for (const group of query.groupBy ?? []) {
    if (group.direction) parts.push(`${fieldRef(group.fieldId)} ${group.direction}`);
  }
  const rowSort = sortToGql(query.sort);
  if (rowSort) {
    if (!rowSort.ok) return rowSort;
    parts.push(rowSort.source);
  }
  return parts.length > 0 ? { ok: true, source: parts.join(", ") } : undefined;
};

export const searchToGql = (search: SearchSpec | undefined): string | undefined => {
  if (!search?.q.trim()) return undefined;
  const fields = search.fieldIds?.length ? ` in ${search.fieldIds.map(fieldRef).join(", ")}` : "";
  return `${literal(search.q.trim())}${fields}`;
};

export const simpleQueryToGqlSource = (args: { tableId: string; query: RecordQuery }): ConvertResult => {
  if ((args.query.aggregations?.length ?? 0) > 0 && (args.query.groupBy?.length ?? 0) === 0) {
    return unsupported("table footer aggregations are not part of row GQL source; use a direct GQL aggregate query");
  }

  const lines = [`from table {${args.tableId}}`];
  const columns = columnsToGql(args.query.columns);
  if (columns) {
    if (!columns.ok) return columns;
    lines.push(`select ${columns.source}`);
  }
  const fieldWhere = filterToGqlWhere(args.query.filter);
  const recordWhere = recordMetaToGqlWhere(args.query.recordMeta);
  const whereParts: string[] = [];
  for (const where of [fieldWhere, recordWhere]) {
    if (where) {
      if (!where.ok) return where;
      whereParts.push(where.source);
    }
  }
  if (whereParts.length > 0) lines.push(`where ${whereParts.length === 1 ? whereParts[0] : whereParts.map((part) => `(${part})`).join(" and ")}`);
  const groupBy = groupByToGql(args.query.groupBy);
  if (groupBy) {
    if (!groupBy.ok) return groupBy;
    lines.push(`group by ${groupBy.source}`);
  }
  const aggregations = aggregationsToGql(args.query.aggregations);
  if (aggregations) {
    if (!aggregations.ok) return aggregations;
    lines.push(`aggregate ${aggregations.source}`);
  }
  const sort = groupedSortToGql(args.query);
  if (sort) {
    if (!sort.ok) return sort;
    lines.push(`sort ${sort.source}`);
  }
  const search = searchToGql(args.query.search);
  if (search) lines.push(`search ${search}`);
  if (args.query.deletedOnly) lines.push("deleted only");
  else if (args.query.includeDeleted) lines.push("include deleted");
  if (args.query.limit) lines.push(`limit ${args.query.limit}`);
  return { ok: true, source: lines.join("\n") };
};
