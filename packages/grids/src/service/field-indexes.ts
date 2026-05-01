import { sql } from "bun";
import { logger } from "@valentinkolb/cloud/services";

const log = logger("grids:field-indexes");

/**
 * Per-field expression index management. Indexes are opt-in (`field.indexed`)
 * and built with `CONCURRENTLY` so they don't lock writers on large tables.
 *
 * Index names: `idx_grids_data_<fieldId-no-dashes>` keeps us under Postgres'
 * 63-char identifier limit (32 hex chars + prefix = ~52). All indexes are
 * partial: only over live (non-deleted) records.
 */

const indexName = (fieldId: string): string => `idx_grids_data_${fieldId.replace(/-/g, "")}`;
const trgmIndexName = (fieldId: string): string => `idx_grids_trgm_${fieldId.replace(/-/g, "")}`;

const indexExpressionForType = (fieldId: string, type: string): string | null => {
  switch (type) {
    case "number":
    case "decimal":
    case "rating":
    case "autonumber":
      return `((data->>'${fieldId}')::numeric)`;
    case "date":
      return `((data->>'${fieldId}')::date)`;
    case "boolean":
      return `((data->>'${fieldId}')::boolean)`;
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

/**
 * Ensures the expression index exists for an indexed field. Idempotent —
 * uses IF NOT EXISTS. Runs CONCURRENTLY so it can't be inside a transaction;
 * caller must invoke this OUTSIDE any in-flight tx (which is the case in
 * field.update / field.create where the tx is already committed).
 */
export const ensureFieldIndex = async (fieldId: string, type: string): Promise<void> => {
  // Field IDs are UUIDs (constrained set [a-f0-9-]) so embedding them in
  // SQL identifiers is safe — no other path produces a `fieldId` value.
  if (!/^[a-f0-9-]+$/i.test(fieldId)) {
    log.warn("Refusing to create index for invalid fieldId", { fieldId });
    return;
  }

  const expression = indexExpressionForType(fieldId, type);
  if (!expression) {
    // multi-select / unsupported types use a different strategy (jsonb_path_ops GIN).
    if (type === "multi-select") {
      const idx = indexName(fieldId);
      try {
        await sql.unsafe(
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idx} ON grids.records USING gin ((data->'${fieldId}') jsonb_path_ops) WHERE deleted_at IS NULL`,
        );
        log.info("Created multi-select GIN index", { fieldId, idx });
      } catch (e) {
        log.error("Failed to create multi-select GIN index", { fieldId, error: String(e) });
      }
    }
    return;
  }

  const idx = indexName(fieldId);
  try {
    await sql.unsafe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idx} ON grids.records ${expression} WHERE deleted_at IS NULL`,
    );
    log.info("Created expression index", { fieldId, idx });
  } catch (e) {
    log.error("Failed to create expression index", { fieldId, error: String(e) });
  }

  // Trigram index for text fields — accelerates `contains`/`startsWith`.
  if (type === "text" || type === "longtext") {
    const tidx = trgmIndexName(fieldId);
    try {
      // pg_trgm is a postgres extension; ensure it's available.
      await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await sql.unsafe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${tidx} ON grids.records USING gin ((data->>'${fieldId}') gin_trgm_ops) WHERE deleted_at IS NULL`,
      );
      log.info("Created text trigram index", { fieldId, tidx });
    } catch (e) {
      log.error("Failed to create trigram index", { fieldId, error: String(e) });
    }
  }
};

/**
 * Drops both the expression and trigram indexes for a field. Idempotent.
 * Called when the user toggles `indexed: false` or deletes the field.
 */
export const dropFieldIndex = async (fieldId: string): Promise<void> => {
  if (!/^[a-f0-9-]+$/i.test(fieldId)) return;

  for (const idx of [indexName(fieldId), trgmIndexName(fieldId)]) {
    try {
      await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS grids.${idx}`);
    } catch (e) {
      log.error("Failed to drop index", { fieldId, idx, error: String(e) });
    }
  }
};
