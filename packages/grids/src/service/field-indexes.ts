import { sql } from "bun";
import { logger } from "@valentinkolb/cloud/services";

const log = logger("grids:field-indexes");

/**
 * Per-field expression index management. Indexes are opt-in (`field.indexed`)
 * and built with `CONCURRENTLY` so they don't lock writers on large tables.
 *
 * Index names: `idx_grids_data_<fieldId-no-dashes>` keeps us under Postgres'
 * 63-char identifier limit (32 hex chars + prefix = ~52). All indexes are
 * partial: only over live records in the owning table that actually contain
 * the JSONB field key. That keeps indexes small even when all tables share the
 * physical `grids.records` table.
 */

const indexName = (fieldId: string): string => `idx_grids_data_${fieldId.replace(/-/g, "")}`;
const trgmIndexName = (fieldId: string): string => `idx_grids_trgm_${fieldId.replace(/-/g, "")}`;
const uniqueIndexName = (fieldId: string): string => `uq_grids_data_${fieldId.replace(/-/g, "")}`;
const autonumberSeqName = (fieldId: string): string => `grids_an_${fieldId.replace(/-/g, "")}`;

/** Strict UUID-with-or-without-dashes validator. Used as the safety
 *  gate before embedding fieldId in DDL identifiers. */
const isSafeFieldId = (fieldId: string): boolean => /^[a-f0-9-]+$/i.test(fieldId);

const indexExpressionForType = (fieldId: string, type: string): string | null => {
  switch (type) {
    case "number":
    case "decimal":
    case "rating":
    case "autonumber":
    case "percent":
    case "duration":
    case "currency":
      // All decimal-backed types share the numeric expression index.
      // Currency stores a plain decimal (the symbol lives in field
      // config) so it indexes identically.
      return `(grids.try_numeric(data->>'${fieldId}'))`;
    case "date":
      // Date expression indexes use the raw cast because Postgres
      // expression indexes require IMMUTABLE functions; grids.try_date is
      // intentionally STABLE. Record validation stores ISO dates, so this
      // is safe for indexed fields with valid app-written data.
      return `((data->>'${fieldId}')::date)`;
    case "boolean":
      return `(grids.try_boolean(data->>'${fieldId}'))`;
    case "text":
    case "longtext":
    case "single-select":
      return `(data->>'${fieldId}')`;
    case "multi-select":
      // jsonb GIN with path_ops for containment.
      return null;
    default:
      return null;
  }
};

const fieldIndexWhere = (fieldId: string, tableId: string): string =>
  `WHERE table_id = '${tableId}'::uuid AND deleted_at IS NULL AND data ? '${fieldId}'`;

/**
 * Ensures the expression index exists for an indexed field. Idempotent —
 * uses IF NOT EXISTS. Runs CONCURRENTLY so it can't be inside a transaction;
 * caller must invoke this OUTSIDE any in-flight tx (which is the case in
 * field.update / field.create where the tx is already committed).
 */
export const ensureFieldIndex = async (
  fieldId: string,
  type: string,
  tableId: string,
): Promise<void> => {
  // Field IDs are UUIDs (constrained set [a-f0-9-]) so embedding them in
  // SQL identifiers is safe — no other path produces a `fieldId` value.
  if (!isSafeFieldId(fieldId) || !isSafeFieldId(tableId)) {
    log.warn("Refusing to create index for invalid id", { fieldId, tableId });
    return;
  }

  const expression = indexExpressionForType(fieldId, type);
  if (!expression) {
    // multi-select / unsupported types use a different strategy (jsonb_path_ops GIN).
    if (type === "multi-select") {
      const idx = indexName(fieldId);
      try {
        await sql.unsafe(
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idx}
           ON grids.records USING gin ((data->'${fieldId}') jsonb_path_ops)
           ${fieldIndexWhere(fieldId, tableId)}`,
        );
        log.info("Created multi-select GIN index", { fieldId, tableId, idx });
      } catch (e) {
        log.error("Failed to create multi-select GIN index", { fieldId, tableId, error: String(e) });
      }
    }
    return;
  }

  const idx = indexName(fieldId);
  try {
    await sql.unsafe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idx}
       ON grids.records ${expression}
       ${fieldIndexWhere(fieldId, tableId)}`,
    );
    log.info("Created expression index", { fieldId, tableId, idx });
  } catch (e) {
    log.error("Failed to create expression index", { fieldId, tableId, error: String(e) });
  }

  // Trigram index for text fields — accelerates `contains`/`startsWith`.
  if (type === "text" || type === "longtext") {
    const tidx = trgmIndexName(fieldId);
    try {
      // pg_trgm is a postgres extension; ensure it's available.
      await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await sql.unsafe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${tidx}
         ON grids.records USING gin ((data->>'${fieldId}') gin_trgm_ops)
         ${fieldIndexWhere(fieldId, tableId)}`,
      );
      log.info("Created text trigram index", { fieldId, tableId, tidx });
    } catch (e) {
      log.error("Failed to create trigram index", { fieldId, tableId, error: String(e) });
    }
  }
};

/**
 * Drops both the expression and trigram indexes for a field. Idempotent.
 * Called when the user toggles `indexed: false` or deletes the field.
 */
export const dropFieldIndex = async (fieldId: string): Promise<void> => {
  if (!isSafeFieldId(fieldId)) return;

  for (const idx of [indexName(fieldId), trgmIndexName(fieldId)]) {
    try {
      await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS grids.${idx}`);
    } catch (e) {
      log.error("Failed to drop index", { fieldId, idx, error: String(e) });
    }
  }
};

// =============================================================================
// Unique-constraint enforcement (Slice 7 bug fix)
// =============================================================================
// Pre-v3, `fields.unique_constraint` was stored on the row but never
// enforced — toggling it had no effect. v3 backs the toggle with a
// real partial unique index over the JSONB-projected value, scoped to
// live records of the table.
//
// Multi-select / relation field types are explicitly rejected at the
// API boundary because their value isn't a scalar — uniqueness over
// a JSONB array doesn't have a well-defined semantic.

const UNIQUE_SUPPORTED_TYPES = new Set([
  "text", "longtext", "number", "decimal", "currency", "percent",
  "rating", "date", "single-select", "boolean", "autonumber",
  "email", "url", "phone", "slug", "barcode", "isbn",
]);

export const isUniqueable = (type: string): boolean => UNIQUE_SUPPORTED_TYPES.has(type);

/**
 * Creates a partial unique index on `(table_id, (data->>'<fieldId>'))`
 * for live records. CONCURRENTLY because creation can take seconds on
 * large tables and shouldn't block writes.
 *
 * Will FAIL (Postgres-side, surfaced via the catch + log) if existing
 * data violates uniqueness — caller is expected to pre-check via
 * `findUniqueConflicts` and surface a 409 to the user before toggling.
 */
export const ensureFieldUniqueIndex = async (
  fieldId: string,
  type: string,
  tableId: string,
): Promise<void> => {
  if (!isSafeFieldId(fieldId) || !isSafeFieldId(tableId)) {
    log.warn("Refusing to create unique index for invalid id", { fieldId, tableId });
    return;
  }
  if (!isUniqueable(type)) {
    log.warn("unique_constraint skipped: type not supported", { fieldId, type });
    return;
  }
  const idx = uniqueIndexName(fieldId);
  // Drop any pre-existing index by this name first. CONCURRENTLY+IF
  // NOT EXISTS would otherwise see an INVALID index left from a
  // previous failed build and skip re-creation, leaving the field
  // toggle's enforcement permanently broken until manual cleanup.
  try {
    await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS grids.${idx}`);
  } catch (e) {
    log.warn("Pre-create DROP INDEX failed (continuing)", { fieldId, idx, error: String(e) });
  }
  try {
    await sql.unsafe(
      `CREATE UNIQUE INDEX CONCURRENTLY ${idx}
       ON grids.records ((data->>'${fieldId}'))
       WHERE table_id = '${tableId}'::uuid AND deleted_at IS NULL AND data ? '${fieldId}'`,
    );
    log.info("Created unique index", { fieldId, idx });
  } catch (e) {
    log.error("Failed to create unique index", { fieldId, idx, error: String(e) });
    // Best-effort cleanup of the (now INVALID) partially-built index.
    try {
      await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS grids.${idx}`);
    } catch {}
    throw e;
  }
};

export const dropFieldUniqueIndex = async (fieldId: string): Promise<void> => {
  if (!isSafeFieldId(fieldId)) return;
  try {
    await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS grids.${uniqueIndexName(fieldId)}`);
  } catch (e) {
    log.error("Failed to drop unique index", { fieldId, error: String(e) });
  }
};

/**
 * Pre-flight: returns the list of values that would violate uniqueness
 * if the constraint were turned on right now. Lets the API return a
 * clean 409 with a list of offenders instead of letting Postgres throw
 * a generic duplicate-key error during index build.
 */
export const findUniqueConflicts = async (
  fieldId: string,
  tableId: string,
): Promise<string[]> => {
  if (!isSafeFieldId(fieldId) || !isSafeFieldId(tableId)) return [];
  const rows = await sql.unsafe(
    `SELECT data->>'${fieldId}' AS v
     FROM grids.records
     WHERE table_id = '${tableId}'::uuid AND deleted_at IS NULL AND data ? '${fieldId}'
     GROUP BY data->>'${fieldId}'
     HAVING COUNT(*) > 1`,
  );
  return (rows as Array<{ v: string }>).map((r) => r.v);
};

// =============================================================================
// Autonumber sequence (Slice 7 bug fix — race-free counter)
// =============================================================================
// Pre-v3 autonumber was `SELECT MAX(...) + 1` — two concurrent inserts
// got the same number. v3 backs each autonumber field with a Postgres
// sequence, lazily created on first use. nextval() is atomic.

/**
 * Lazy CREATE SEQUENCE IF NOT EXISTS on first use. Idempotent. Safe
 * inside a regular transaction (sequences in Postgres survive rollback,
 * which is the desired property: rolled-back inserts still consume a
 * sequence value, ensuring monotonicity even under failures).
 */
export const ensureAutonumberSequence = async (fieldId: string): Promise<string | null> => {
  if (!isSafeFieldId(fieldId)) return null;
  const seq = autonumberSeqName(fieldId);
  await sql.unsafe(`CREATE SEQUENCE IF NOT EXISTS grids.${seq} AS BIGINT INCREMENT 1 MINVALUE 1`);
  return seq;
};

/** Atomically returns the next value. Creates the sequence if missing. */
export const nextAutonumberValue = async (fieldId: string): Promise<number> => {
  const seq = await ensureAutonumberSequence(fieldId);
  if (!seq) return 1;
  const rows = await sql.unsafe(`SELECT nextval('grids.${seq}') AS next`);
  const next = (rows as Array<{ next: bigint | string | number }>)[0]?.next;
  return Number(next ?? 1);
};

export const dropAutonumberSequence = async (fieldId: string): Promise<void> => {
  if (!isSafeFieldId(fieldId)) return;
  try {
    await sql.unsafe(`DROP SEQUENCE IF EXISTS grids.${autonumberSeqName(fieldId)}`);
  } catch (e) {
    log.error("Failed to drop autonumber sequence", { fieldId, error: String(e) });
  }
};
