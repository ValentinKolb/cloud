import { sql } from "bun";
import type { Field } from "./types";

/**
 * Field-storage descriptor: single source of truth for "how does this
 * field type live in JSONB / record_links, and what shape do compilers
 * project it as?"
 *
 * Before this module, every compiler (filter/sort/group/aggregate/
 * computed/search/field-indexes) re-spelled the SQL projection rules.
 * They drifted in small but expensive ways: numeric fields, computed
 * projections, filters, and indexes each carried their own idea of
 * how JSONB values should be projected. This module keeps that contract
 * in one place.
 *
 * The contract here is small on purpose:
 *  - `project(field, alias)` returns the typed SQL projection used in
 *    WHERE / ORDER BY / aggregate expressions. NULL-on-parse-failure
 *    where applicable (`grids.try_numeric/try_iso_date/boolean/timestamptz`).
 *  - `formatKind` drives UI cell formatting.
 *  - capability flags (sortable/filterable/etc) tell compilers whether
 *    the field type is supported in their op family. Compilers reject
 *    unsupported combinations with a clean compile error rather than
 *    silently falling through to text or all-NULL.
 *
 * What this descriptor does NOT model:
 *  - Text-shape projections like `data->>${id}` for `IS NULL` / select-id
 *    equality. That's a different concern from the typed projection
 *    and stays inline in filter-compiler.
 *  - Select jsonb-array operations. Select uses
 *    `(data->fieldId)::jsonb @> ...` style which has no scalar
 *    projection equivalent; consumers handle it via the descriptor's
 *    `kind: "jsonbArray"`.
 *  - Relation / lookup / rollup / formula / system fields — they have
 *    their own pipelines (record_links + computed-projections); the
 *    descriptor reports `null` from `project()` and the right kind so
 *    the compiler can route correctly.
 */
export type ProjectionKind =
  | "text" // data->>id (text)
  | "numeric" // try_numeric(data->>id)
  | "boolean" // try_boolean(data->>id)
  | "date" // try_iso_date(data->>id)
  | "datetime" // try_timestamptz(data->>id)
  | "jsonbArray" // select arrays; no scalar projection
  | "relationLink" // record_links junction
  | "computed" // formula/lookup/rollup; hydrated post-query
  | "system" // created_at / updated_at / created_by / updated_by — column, not JSONB
  | "json" // free-form JSON; data->id; no scalar projection
  | "unknown"; // unrecognised field type — defensive fallback

type FormatKind =
  | "text"
  | "longtext"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "percent"
  | "duration"
  | "json"
  | "relation"
  | "file"
  | "computed"
  | "system"
  | "unknown";

type StorageDescriptor = {
  kind: ProjectionKind;
  /**
   * SQL fragment for this field's value in the given table alias's
   * scope. Returns null for kinds that have no scalar projection
   * (jsonbArray, relationLink, computed, json). Callers branch on
   * `kind` first; `project()` is the convenience accessor for kinds
   * that DO have a scalar projection.
   */
  project: (field: Field, alias: string) => unknown | null;
  formatKind: FormatKind;
  sortable: boolean;
  filterable: boolean;
  groupable: boolean;
  /** Can be used in scalar aggregates (sum/avg/min/max). count/* always allowed. */
  aggregatable: boolean;
  /** Cursor-safe — sort cursors can encode/decode this without losing precision. */
  cursorable: boolean;
  /** Direct text-searchable via this descriptor. Broader global search
   *  (numbers/select labels/relations) is compiled in service/search.ts. */
  searchable: boolean;
};

export type FieldSqlScalarType = "numeric" | "text" | "boolean" | "date" | "datetime" | "unknown";
export type FieldSqlOutputType = FieldSqlScalarType | "json";

const data = (alias: string) => sql.unsafe(`${alias}.data`);

const tryNumeric = (alias: string, fieldId: string) => sql`grids.try_numeric(${data(alias)}->>${fieldId})`;
const tryDate = (alias: string, fieldId: string) => sql`grids.try_iso_date(${data(alias)}->>${fieldId})`;
const tryTimestampTz = (alias: string, fieldId: string) => sql`grids.try_timestamptz(${data(alias)}->>${fieldId})`;
const tryBoolean = (alias: string, fieldId: string) => sql`grids.try_boolean(${data(alias)}->>${fieldId})`;
const textOf = (alias: string, fieldId: string) => sql`${data(alias)}->>${fieldId}`;

const STORAGE: Record<string, StorageDescriptor> = {
  // ── Text family ──────────────────────────────────────────────────
  text: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "text",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: false,
    cursorable: true,
    searchable: true,
  },
  longtext: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "longtext",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: false,
    cursorable: true,
    searchable: true,
  },
  // ── Generated identifiers ────────────────────────────────────────
  id: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "text",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: false,
    cursorable: true,
    searchable: true,
  },
  // ── Numeric family ───────────────────────────────────────────────
  number: {
    kind: "numeric",
    project: (f, a) => tryNumeric(a, f.id),
    formatKind: "number",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: true,
    cursorable: true,
    searchable: false,
  },
  percent: {
    kind: "numeric",
    project: (f, a) => tryNumeric(a, f.id),
    formatKind: "percent",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: true,
    cursorable: true,
    searchable: false,
  },
  duration: {
    kind: "numeric",
    project: (f, a) => tryNumeric(a, f.id),
    formatKind: "duration",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: true,
    cursorable: true,
    searchable: false,
  },
  // ── Date / time ──────────────────────────────────────────────────
  date: {
    kind: "date",
    project: (f, a) => ((f.config as { includeTime?: boolean }).includeTime ? tryTimestampTz(a, f.id) : tryDate(a, f.id)),
    formatKind: "date",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: true /* min/max */,
    cursorable: true,
    searchable: false,
  },
  // ── Boolean ──────────────────────────────────────────────────────
  boolean: {
    kind: "boolean",
    project: (f, a) => tryBoolean(a, f.id),
    formatKind: "boolean",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: false,
    cursorable: true,
    searchable: false,
  },
  // ── Select ───────────────────────────────────────────────────────
  select: {
    kind: "jsonbArray",
    project: () => null,
    formatKind: "select",
    sortable: false /* arrays have no canonical scalar sort */,
    filterable: true /* via @> */,
    groupable: true /* explode-mode group: one bucket contribution per selected option */,
    aggregatable: false,
    cursorable: false,
    searchable: false,
  },
  // ── JSON ─────────────────────────────────────────────────────────
  json: {
    kind: "json",
    project: () => null,
    formatKind: "json",
    sortable: false,
    filterable: false,
    groupable: false,
    aggregatable: false,
    cursorable: false,
    searchable: false,
  },
  file: {
    kind: "computed",
    project: () => null,
    formatKind: "file",
    sortable: false,
    filterable: false,
    groupable: false,
    aggregatable: false,
    cursorable: false,
    searchable: false,
  },
  // ── Relations & computed ────────────────────────────────────────
  relation: {
    kind: "relationLink",
    project: () => null,
    formatKind: "relation",
    sortable: false /* no canonical scalar */,
    filterable: false /* relation filtering goes through record_links — separate path */,
    groupable: true /* explode-mode group via record_links join */,
    aggregatable: false /* relation count must use record_links — handled by caller */,
    cursorable: false,
    searchable: false,
  },
  formula: {
    kind: "computed",
    project: () => null,
    formatKind: "computed",
    sortable: false,
    filterable: false,
    groupable: false,
    aggregatable: false,
    cursorable: false,
    searchable: false,
  },
  lookup: {
    kind: "computed",
    project: () => null,
    formatKind: "computed",
    sortable: false,
    filterable: false,
    groupable: false,
    aggregatable: false,
    cursorable: false,
    searchable: false,
  },
  rollup: {
    kind: "computed",
    project: () => null,
    formatKind: "computed",
    sortable: false,
    filterable: false,
    groupable: false,
    aggregatable: false,
    cursorable: false,
    searchable: false,
  },
  // ── System (auto-managed columns, NOT JSONB) ─────────────────────
  created_at: {
    kind: "system",
    project: (_, a) => sql.unsafe(`${a}.created_at`),
    formatKind: "datetime",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: true,
    cursorable: true,
    searchable: false,
  },
  updated_at: {
    kind: "system",
    project: (_, a) => sql.unsafe(`${a}.updated_at`),
    formatKind: "datetime",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: true,
    cursorable: true,
    searchable: false,
  },
  deleted_at: {
    kind: "system",
    project: (_, a) => sql.unsafe(`${a}.deleted_at`),
    formatKind: "datetime",
    sortable: true,
    filterable: true,
    groupable: true,
    aggregatable: true,
    cursorable: true,
    searchable: false,
  },
  created_by: {
    kind: "system",
    project: (_, a) => sql.unsafe(`${a}.created_by`),
    formatKind: "system",
    sortable: false,
    filterable: true,
    groupable: true,
    aggregatable: false,
    cursorable: false,
    searchable: false,
  },
  updated_by: {
    kind: "system",
    project: (_, a) => sql.unsafe(`${a}.updated_by`),
    formatKind: "system",
    sortable: false,
    filterable: true,
    groupable: true,
    aggregatable: false,
    cursorable: false,
    searchable: false,
  },
};

const UNKNOWN_DESCRIPTOR: StorageDescriptor = {
  kind: "unknown",
  project: () => null,
  formatKind: "unknown",
  sortable: false,
  filterable: false,
  groupable: false,
  aggregatable: false,
  cursorable: false,
  searchable: false,
};

/**
 * Returns the storage descriptor for `field`. Unknown types fall through
 * to a defensive `unknown` descriptor that disables every operation —
 * no silent text-fallback. The compiler reports the unsupported field
 * type as a compile error rather than emitting a SQL projection that
 * silently coerces.
 */
export const storageOf = (field: Field): StorageDescriptor => STORAGE[field.type] ?? UNKNOWN_DESCRIPTOR;

const systemSqlTypeFor = (field: Field): FieldSqlScalarType => {
  if (field.type === "created_at" || field.type === "updated_at" || field.type === "deleted_at") return "datetime";
  if (field.type === "created_by" || field.type === "updated_by") return "text";
  return "unknown";
};

export const scalarSqlTypeForField = (field: Field): FieldSqlScalarType => {
  const descriptor = storageOf(field);
  if (descriptor.kind === "numeric") return "numeric";
  if (descriptor.kind === "text") return "text";
  if (descriptor.kind === "boolean") return "boolean";
  if (descriptor.kind === "date") return (field.config as { includeTime?: boolean }).includeTime ? "datetime" : "date";
  if (descriptor.kind === "datetime") return "datetime";
  if (descriptor.kind === "system") return systemSqlTypeFor(field);
  return "unknown";
};

export const outputSqlTypeForField = (field: Field): FieldSqlOutputType => {
  const descriptor = storageOf(field);
  if (descriptor.kind === "json" || descriptor.kind === "jsonbArray" || descriptor.kind === "relationLink") return "json";
  return scalarSqlTypeForField(field);
};

export const groupSqlTypeForField = (field: Field): FieldSqlOutputType => {
  const descriptor = storageOf(field);
  if (descriptor.kind === "relationLink" || descriptor.kind === "jsonbArray") return "text";
  return outputSqlTypeForField(field);
};
