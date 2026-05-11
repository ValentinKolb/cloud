import { sql } from "bun";
import type { Field } from "./types";

/**
 * Field-storage descriptor: single source of truth for "how does this
 * field type live in JSONB / record_links, and what shape do compilers
 * project it as?"
 *
 * Before this module, every compiler (filter/sort/group/aggregate/
 * computed/search/field-indexes) re-spelled the SQL projection rules.
 * They drifted: currency aggregates used `data->fieldId->>'amount'`
 * while currency rollup used `data->>targetFieldId` (returning the
 * JSON-stringified blob, NOT the amount). That was the chunk 3
 * critical "currency rollups coerced differently from aggregates".
 *
 * The contract here is small on purpose:
 *  - `project(field, alias)` returns the typed SQL projection used in
 *    WHERE / ORDER BY / aggregate expressions. NULL-on-parse-failure
 *    where applicable (`grids.try_numeric/date/boolean/timestamptz`).
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
 *  - Multi-select jsonb-array operations. Multi-select uses
 *    `(data->fieldId)::jsonb @> ...` style which has no scalar
 *    projection equivalent; consumers handle it via the descriptor's
 *    `kind: "jsonbArray"`.
 *  - Relation / lookup / rollup / formula / system fields — they have
 *    their own pipelines (record_links + computed-projections); the
 *    descriptor reports `null` from `project()` and the right kind so
 *    the compiler can route correctly.
 */
export type ProjectionKind =
  | "text"            // data->>id (text)
  | "numeric"         // try_numeric(data->>id)
  | "decimal"         // try_numeric(data->>id) — same SQL shape as numeric, formatKind differs.
                      // Currency uses this kind too (decimal-backed amount, free-text symbol
                      // lives in field config; no special JSON path).
  | "boolean"         // try_boolean(data->>id)
  | "date"            // try_date(data->>id)
  | "datetime"        // try_timestamptz(data->>id)
  | "selectId"        // data->>id (option id text)
  | "jsonbArray"      // multi-select; no scalar projection
  | "relationLink"    // record_links junction
  | "computed"        // formula/lookup/rollup; hydrated post-query
  | "system"          // created_at / updated_at / created_by / updated_by — column, not JSONB
  | "json"            // free-form JSON; data->id; no scalar projection
  | "unknown";        // unrecognised field type — defensive fallback

export type FormatKind =
  | "text"
  | "longtext"
  | "number"
  | "decimal"
  | "rating"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "multiSelect"
  | "money"
  | "percent"
  | "duration"
  | "json"
  | "relation"
  | "computed"
  | "system"
  | "unknown";

export type StorageDescriptor = {
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
  /** Free-text ILIKE / `contains` searchable. Mirrors search.ts SEARCHABLE_TYPES. */
  searchable: boolean;
};

const data = (alias: string) => sql.unsafe(`${alias}.data`);

const tryNumeric = (alias: string, fieldId: string) =>
  sql`grids.try_numeric(${data(alias)}->>${fieldId})`;
const tryDate = (alias: string, fieldId: string) =>
  sql`grids.try_date(${data(alias)}->>${fieldId})`;
const tryTimestamp = (alias: string, fieldId: string) =>
  sql`grids.try_timestamptz(${data(alias)}->>${fieldId})`;
const tryBoolean = (alias: string, fieldId: string) =>
  sql`grids.try_boolean(${data(alias)}->>${fieldId})`;
const textOf = (alias: string, fieldId: string) =>
  sql`${data(alias)}->>${fieldId}`;

const STORAGE: Record<string, StorageDescriptor> = {
  // ── Text family ──────────────────────────────────────────────────
  text: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "text",
    sortable: true, filterable: true, groupable: true,
    aggregatable: false, cursorable: true, searchable: true,
  },
  longtext: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "longtext",
    sortable: true, filterable: true, groupable: true,
    aggregatable: false, cursorable: true, searchable: true,
  },
  email: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "text",
    sortable: true, filterable: true, groupable: true,
    aggregatable: false, cursorable: true, searchable: true,
  },
  url: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "text",
    sortable: true, filterable: true, groupable: true,
    aggregatable: false, cursorable: true, searchable: true,
  },
  phone: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "text",
    sortable: true, filterable: true, groupable: true,
    aggregatable: false, cursorable: true, searchable: true,
  },
  slug: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "text",
    sortable: true, filterable: true, groupable: true,
    aggregatable: false, cursorable: true, searchable: true,
  },
  barcode: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "text",
    sortable: true, filterable: true, groupable: true,
    aggregatable: false, cursorable: true, searchable: true,
  },
  isbn: {
    kind: "text",
    project: (f, a) => textOf(a, f.id),
    formatKind: "text",
    sortable: true, filterable: true, groupable: true,
    aggregatable: false, cursorable: true, searchable: true,
  },
  // ── Numeric family ───────────────────────────────────────────────
  number: {
    kind: "numeric",
    project: (f, a) => tryNumeric(a, f.id),
    formatKind: "number",
    sortable: true, filterable: true, groupable: true,
    aggregatable: true, cursorable: true, searchable: false,
  },
  decimal: {
    kind: "decimal",
    project: (f, a) => tryNumeric(a, f.id),
    formatKind: "decimal",
    sortable: true, filterable: true, groupable: true,
    aggregatable: true, cursorable: true, searchable: false,
  },
  rating: {
    kind: "numeric",
    project: (f, a) => tryNumeric(a, f.id),
    formatKind: "rating",
    sortable: true, filterable: true, groupable: true,
    aggregatable: true, cursorable: true, searchable: false,
  },
  autonumber: {
    kind: "numeric",
    project: (f, a) => tryNumeric(a, f.id),
    formatKind: "number",
    sortable: true, filterable: true, groupable: true,
    aggregatable: true, cursorable: true, searchable: false,
  },
  percent: {
    kind: "numeric",
    project: (f, a) => tryNumeric(a, f.id),
    formatKind: "percent",
    sortable: true, filterable: true, groupable: true,
    aggregatable: true, cursorable: true, searchable: false,
  },
  duration: {
    kind: "numeric",
    project: (f, a) => tryNumeric(a, f.id),
    formatKind: "duration",
    sortable: true, filterable: true, groupable: true,
    aggregatable: true, cursorable: true, searchable: false,
  },
  currency: {
    // Currency is now decimal-backed (just a number) with a
    // display-only symbol in field config — see currencyHandler. The
    // SQL contract matches decimal exactly: `try_numeric(data->>id)`,
    // not the legacy `data->fieldId->>'amount'`. Every numeric
    // compiler (aggregate / group / sort / rollup) treats currency
    // identically to decimal as a result.
    kind: "decimal",
    project: (f, a) => tryNumeric(a, f.id),
    formatKind: "money",
    sortable: true, filterable: true, groupable: true,
    aggregatable: true, cursorable: true, searchable: false,
  },
  // ── Date / time ──────────────────────────────────────────────────
  date: {
    kind: "date",
    project: (f, a) => tryDate(a, f.id),
    formatKind: "date",
    sortable: true, filterable: true, groupable: true,
    aggregatable: true /* min/max */, cursorable: true, searchable: false,
  },
  // ── Boolean ──────────────────────────────────────────────────────
  boolean: {
    kind: "boolean",
    project: (f, a) => tryBoolean(a, f.id),
    formatKind: "boolean",
    sortable: true, filterable: true, groupable: true,
    aggregatable: false, cursorable: true, searchable: false,
  },
  // ── Select ───────────────────────────────────────────────────────
  "single-select": {
    kind: "selectId",
    project: (f, a) => textOf(a, f.id),
    formatKind: "select",
    sortable: true, filterable: true, groupable: true,
    aggregatable: false, cursorable: true, searchable: false,
  },
  "multi-select": {
    kind: "jsonbArray",
    project: () => null,
    formatKind: "multiSelect",
    sortable: false /* arrays have no canonical scalar sort */,
    filterable: true /* via @> */,
    groupable: false /* a record contributes to multiple buckets ambiguously */,
    aggregatable: false, cursorable: false, searchable: false,
  },
  // ── JSON ─────────────────────────────────────────────────────────
  json: {
    kind: "json",
    project: () => null,
    formatKind: "json",
    sortable: false, filterable: false, groupable: false,
    aggregatable: false, cursorable: false, searchable: false,
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
    cursorable: false, searchable: false,
  },
  formula: {
    kind: "computed",
    project: () => null,
    formatKind: "computed",
    sortable: false, filterable: false, groupable: false,
    aggregatable: false, cursorable: false, searchable: false,
  },
  lookup: {
    kind: "computed",
    project: () => null,
    formatKind: "computed",
    sortable: false, filterable: false, groupable: false,
    aggregatable: false, cursorable: false, searchable: false,
  },
  rollup: {
    kind: "computed",
    project: () => null,
    formatKind: "computed",
    sortable: false, filterable: false, groupable: false,
    aggregatable: false, cursorable: false, searchable: false,
  },
  // ── System (auto-managed columns, NOT JSONB) ─────────────────────
  created_at: {
    kind: "system",
    project: (_, a) => sql.unsafe(`${a}.created_at`),
    formatKind: "datetime",
    sortable: true, filterable: true, groupable: true,
    aggregatable: true, cursorable: true, searchable: false,
  },
  updated_at: {
    kind: "system",
    project: (_, a) => sql.unsafe(`${a}.updated_at`),
    formatKind: "datetime",
    sortable: true, filterable: true, groupable: true,
    aggregatable: true, cursorable: true, searchable: false,
  },
  created_by: {
    kind: "system",
    project: (_, a) => sql.unsafe(`${a}.created_by`),
    formatKind: "system",
    sortable: false, filterable: true, groupable: true,
    aggregatable: false, cursorable: false, searchable: false,
  },
  updated_by: {
    kind: "system",
    project: (_, a) => sql.unsafe(`${a}.updated_by`),
    formatKind: "system",
    sortable: false, filterable: true, groupable: true,
    aggregatable: false, cursorable: false, searchable: false,
  },
};

const UNKNOWN_DESCRIPTOR: StorageDescriptor = {
  kind: "unknown",
  project: () => null,
  formatKind: "unknown",
  sortable: false, filterable: false, groupable: false,
  aggregatable: false, cursorable: false, searchable: false,
};

/**
 * Returns the storage descriptor for `field`. Unknown types fall through
 * to a defensive `unknown` descriptor that disables every operation —
 * no silent text-fallback. The compiler reports the unsupported field
 * type as a compile error rather than emitting a SQL projection that
 * silently coerces.
 */
export const storageOf = (field: Field): StorageDescriptor =>
  STORAGE[field.type] ?? UNKNOWN_DESCRIPTOR;

/** Pure capability check — used by the saved-view query validator
 *  (Wave 4.x) to reject saved queries whose fields can't actually run
 *  in the requested op family. */
export const canSort = (field: Field): boolean => storageOf(field).sortable;
export const canFilter = (field: Field): boolean => storageOf(field).filterable;
export const canGroup = (field: Field): boolean => storageOf(field).groupable;
export const canAggregate = (field: Field): boolean => storageOf(field).aggregatable;
export const canSearch = (field: Field): boolean => storageOf(field).searchable;
