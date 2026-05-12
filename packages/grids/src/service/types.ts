export type Base = {
  id: string;
  /** Short readable handle (5 chars). Used in URLs and as a stable
   *  alias next to the UUID PK. Random + immutable per spec. */
  shortId: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  /** When set, opening `/grids/<base>` with no ?table or ?dashboard
   *  query param redirects to this dashboard. Service treats stale
   *  ids (referenced dashboard soft-deleted) as null, so consumers
   *  can rely on the value being a live dashboard id when non-null. */
  defaultDashboardId: string | null;
  /** Soft-delete tombstone. null = alive, ISO timestamp = trashed. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Table = {
  id: string;
  /** Short readable handle (5 chars), unique per base. URL routing
   *  uses this; the UUID stays internal. */
  shortId: string;
  baseId: string;
  name: string;
  description: string | null;
  position: number;
  /** When true, records can only be added through a form (the
   *  authenticated `/forms/:formId/submit` and the public
   *  `/forms/public/:token/submit` endpoints). Direct inserts via the
   *  records grid or `POST /records` get rejected with 403. Lets a
   *  table act as a gated submission inbox where every entry passes
   *  through form validation. */
  disableDirectInsert: boolean;
  /** Soft-delete tombstone. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Field = {
  id: string;
  /** Short readable handle (5 chars), unique per table. Surfaces in
   *  formula references as `#abc12` and in the field-row CopyButton.
   *  Internal storage + FKs still use the UUID id. */
  shortId: string;
  tableId: string;
  name: string;
  /** Optional helper text shown beside the field in the edit modal and
   *  detail panel. Top-level (not in config) since it's metadata, not
   *  type-specific configuration. */
  description: string | null;
  type: string;
  config: Record<string, unknown>;
  position: number;
  required: boolean;
  /** When true, the field appears in the auto-generated label whenever
   *  this record is referenced elsewhere (relation cells, picker
   *  labels). Multiple presentable fields are joined with " · ". */
  presentable: boolean;
  /** When true, the field is hidden from the default records grid by
   *  default; still rendered in the record detail panel. Views can
   *  override via `view.query.columns`. */
  hideInTable: boolean;
  defaultValue: unknown;
  indexed: boolean;
  uniqueConstraint: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Wrapper shape returned by `record.list` — bundles the rows, the
 * source table's schema (once, not duplicated per record), and the
 * cursor for the next page in a single response. Designed so that
 * presentational components like `<DatabaseTable>` take a single
 * prop and have everything they need to render — no separate
 * fetch-and-pass-as-two-props ceremony.
 *
 * `fields` is included unconditionally. The list resolver fetches
 * the table's fields internally anyway (for filter compilation and
 * relation hydration); echoing them on the way out costs nothing
 * and saves callers a second `field.listByTable` roundtrip.
 *
 * Pagination is cursor-based — `nextCursor` is the opaque token to
 * pass back as `params.cursor` on the next call, or `null` when the
 * current page is the last. We deliberately don't carry a `total`
 * here because counting rows on filtered queries is a separate
 * (expensive) query and most consumers don't actually need it.
 */
export type RecordList = {
  items: GridRecord[];
  fields: Field[];
  nextCursor: string | null;
};

export type GridRecord = {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  /**
   * Optional inline expansion of records this row links to via relation
   * fields. Keyed by the linked record's UUID; the value is a subset of
   * that record's `data` containing exactly the fields needed to render
   * a label (the target table's `presentable` fields plus any explicit
   * `displayFieldId` overrides).
   *
   * Populated only when a record-returning service call is passed
   * `includeRelations: true`. Absent or `undefined` when expansion was
   * not requested, when the record has no relation fields, or when the
   * viewer can't read the target table (last case wired up by the
   * upcoming permission-gate follow-up; for now expansion is unfiltered
   * once requested).
   *
   * Renderers use it to render `<RecordLink>` with a presentable label
   * instead of the raw UUID — zero extra DB calls at render time. The
   * batched lookup that builds this map is O(unique-target-tables) SQL
   * roundtrips per page, never N+1 per cell.
   */
  expanded?: Record<string, Record<string, unknown>>;
  version: number;
  deletedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuditAction = "created" | "updated" | "deleted" | "restored" | "imported";

export type AuditEntry = {
  id: string;
  baseId: string | null;
  tableId: string | null;
  recordId: string | null;
  userId: string | null;
  action: AuditAction;
  diff: Record<string, { old: unknown; new: unknown }> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type GridFile = {
  id: string;
  recordId: string;
  fieldId: string;
  position: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdBy: string | null;
  createdAt: string;
};

export type GridFileContent = GridFile & {
  bytes: Uint8Array;
};

export type CreateBaseInput = { name: string; description?: string | null };
export type UpdateBaseInput = {
  name?: string;
  description?: string | null;
  defaultDashboardId?: string | null;
};

export type CreateTableInput = { baseId: string; name: string; description?: string | null };
export type UpdateTableInput = {
  name?: string;
  description?: string | null;
  disableDirectInsert?: boolean;
};

export type CreateFieldInput = {
  tableId: string;
  name: string;
  description?: string | null;
  type: string;
  config?: Record<string, unknown>;
  position?: number;
  required?: boolean;
  presentable?: boolean;
  hideInTable?: boolean;
  defaultValue?: unknown;
  indexed?: boolean;
  uniqueConstraint?: boolean;
};

export type UpdateFieldInput = {
  name?: string;
  description?: string | null;
  config?: Record<string, unknown>;
  position?: number;
  required?: boolean;
  presentable?: boolean;
  hideInTable?: boolean;
  defaultValue?: unknown;
  indexed?: boolean;
  uniqueConstraint?: boolean;
};
