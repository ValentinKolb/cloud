import { logger } from "@valentinkolb/cloud/services";
import { sql } from "bun";

const log = logger("grids:field-indexes");

/**
 * Per-field expression index management. Indexes are opt-in (`field.indexed`)
 * and built with `CONCURRENTLY` so they don't lock writers on large tables.
 *
 * Index names: `idx_grids_data_<fieldId-no-dashes>` keeps us under Postgres'
 * 63-char identifier limit (32 hex chars + prefix = ~52). Performance indexes
 * are partial by table + live records only. Do NOT add `data ? fieldId` here:
 * the hot query compilers do not emit that predicate, so Postgres cannot prove
 * the partial index applies and falls back to seq scans on 100k+ rows.
 */

const indexName = (fieldId: string): string => `idx_grids_data_${fieldId.replace(/-/g, "")}`;
const trgmIndexName = (fieldId: string): string => `idx_grids_trgm_${fieldId.replace(/-/g, "")}`;
export const fieldUniqueIndexName = (fieldId: string): string => `uq_grids_data_${fieldId.replace(/-/g, "")}`;
const generatedIdSeqPrefix = (fieldId: string): string => `grids_id_${fieldId.replace(/-/g, "")}`;
const generatedIdSeqName = (fieldId: string, scope?: string): string => {
  const suffix = scope ? `_${scope.replace(/[^a-zA-Z0-9_]/g, "")}` : "";
  return `${generatedIdSeqPrefix(fieldId)}${suffix}`;
};

/** Strict UUID-with-or-without-dashes validator. Used as the safety
 *  gate before embedding fieldId in DDL identifiers. */
const isSafeFieldId = (fieldId: string): boolean => /^[a-f0-9-]+$/i.test(fieldId);

const indexExpressionForType = (fieldId: string, type: string, config?: Record<string, unknown>): string | null => {
  switch (type) {
    case "number":
    case "percent":
    case "duration":
      // All numeric field types share the numeric expression index.
      return `((grids.try_numeric(data->>'${fieldId}')))`;
    case "date":
      return (config as { includeTime?: boolean } | undefined)?.includeTime
        ? `((grids.try_timestamptz(data->>'${fieldId}')))`
        : `((grids.try_iso_date(data->>'${fieldId}')))`;
    case "boolean":
      return `((grids.try_boolean(data->>'${fieldId}')))`;
    case "text":
    case "longtext":
    case "id":
      return `((data->>'${fieldId}'))`;
    case "select":
      // jsonb GIN with path_ops for containment.
      return null;
    default:
      return null;
  }
};

const fieldIndexWhere = (_fieldId: string, tableId: string): string => `WHERE table_id = '${tableId}'::uuid AND deleted_at IS NULL`;

/**
 * Ensures the expression index exists for an indexed field. Runs CONCURRENTLY
 * so it can't be inside a transaction;
 * caller must invoke this OUTSIDE any in-flight tx (which is the case in
 * field.update / field.create where the tx is already committed).
 */
export const ensureFieldIndex = async (fieldId: string, type: string, tableId: string, config?: Record<string, unknown>): Promise<void> => {
  // Field IDs are UUIDs (constrained set [a-f0-9-]) so embedding them in
  // SQL identifiers is safe — no other path produces a `fieldId` value.
  if (!isSafeFieldId(fieldId) || !isSafeFieldId(tableId)) {
    log.warn("Refusing to create index for invalid id", { fieldId, tableId });
    return;
  }

  const expression = indexExpressionForType(fieldId, type, config);
  if (!expression) {
    // select / unsupported types use a different strategy (jsonb_path_ops GIN).
    if (type === "select") {
      const idx = indexName(fieldId);
      try {
        await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS grids.${idx}`);
        await sql.unsafe(
          `CREATE INDEX CONCURRENTLY ${idx}
           ON grids.records USING gin ((data->'${fieldId}') jsonb_path_ops)
           ${fieldIndexWhere(fieldId, tableId)}`,
        );
        log.info("Created select GIN index", { fieldId, tableId, idx });
      } catch (e) {
        log.error("Failed to create select GIN index", { fieldId, tableId, error: String(e) });
      }
    }
    return;
  }

  const idx = indexName(fieldId);
  // Recreate by name so old alpha indexes with narrower predicates are
  // replaced the next time ensureFieldIndex runs.
  for (const name of [idx, trgmIndexName(fieldId)]) {
    try {
      await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS grids.${name}`);
    } catch (e) {
      log.warn("Pre-create DROP INDEX failed (continuing)", { fieldId, idx: name, error: String(e) });
    }
  }
  try {
    await sql.unsafe(
      `CREATE INDEX CONCURRENTLY ${idx}
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
        `CREATE INDEX CONCURRENTLY ${tidx}
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

// Unique field constraints use partial expression indexes over live records.
// Select and relation fields are excluded because array uniqueness has no
// single useful record-level meaning.

const UNIQUE_SUPPORTED_TYPES = new Set(["text", "longtext", "number", "percent", "date", "boolean", "id"]);

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
export const ensureFieldUniqueIndex = async (fieldId: string, type: string, tableId: string): Promise<void> => {
  if (!isSafeFieldId(fieldId) || !isSafeFieldId(tableId)) {
    log.warn("Refusing to create unique index for invalid id", { fieldId, tableId });
    return;
  }
  if (!isUniqueable(type)) {
    log.warn("unique_constraint skipped: type not supported", { fieldId, type });
    return;
  }
  const idx = fieldUniqueIndexName(fieldId);
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
    await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS grids.${fieldUniqueIndexName(fieldId)}`);
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
export const findUniqueConflicts = async (fieldId: string, tableId: string): Promise<string[]> => {
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
// Generated ID sequences
// =============================================================================
// Sequence-style generated IDs are backed by Postgres sequences, lazily
// created on first use. nextval() is atomic.

/**
 * Lazy CREATE SEQUENCE IF NOT EXISTS on first use. Idempotent. Safe
 * inside a regular transaction (sequences in Postgres survive rollback,
 * which is the desired property: rolled-back inserts still consume a
 * sequence value, ensuring monotonicity even under failures).
 */
const ensureGeneratedIdSequence = async (fieldId: string, scope?: string, client = sql): Promise<string | null> => {
  if (!isSafeFieldId(fieldId)) return null;
  const seq = generatedIdSeqName(fieldId, scope);
  await client.unsafe(`CREATE SEQUENCE IF NOT EXISTS grids.${seq} AS BIGINT INCREMENT 1 MINVALUE 1`);
  return seq;
};

/** Atomically returns the next value. Creates the sequence if missing. */
export const nextGeneratedIdSequenceValue = async (fieldId: string, scope?: string, client = sql): Promise<number> => {
  const seq = await ensureGeneratedIdSequence(fieldId, scope, client);
  if (!seq) return 1;
  const rows = await client.unsafe(`SELECT nextval('grids.${seq}') AS next`);
  const next = (rows as Array<{ next: bigint | string | number }>)[0]?.next;
  return Number(next ?? 1);
};

export const dropGeneratedIdSequences = async (fieldId: string): Promise<void> => {
  if (!isSafeFieldId(fieldId)) return;
  try {
    const rows = await sql<{ sequence_name: string }[]>`
      SELECT sequence_name
      FROM information_schema.sequences
      WHERE sequence_schema = 'grids'
        AND sequence_name LIKE ${`${generatedIdSeqPrefix(fieldId)}%`}
    `;
    for (const row of rows) {
      if (/^[a-zA-Z0-9_]+$/.test(row.sequence_name)) {
        await sql.unsafe(`DROP SEQUENCE IF EXISTS grids.${row.sequence_name}`);
      }
    }
  } catch (e) {
    log.error("Failed to drop generated ID sequence", { fieldId, error: String(e) });
  }
};
