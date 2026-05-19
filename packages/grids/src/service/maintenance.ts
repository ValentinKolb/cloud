import { sql } from "bun";
import {
  dropAutonumberSequence,
  dropFieldIndex,
  dropFieldUniqueIndex,
} from "./field-indexes";

/**
 * Hygiene jobs for the grids schema. Designed to be idempotent and safe
 * to run as a daily cron.
 *
 *  1. **Hard-purge** of soft-deleted entities older than the grace period
 *     (default 30 days). Once an entity is hard-deleted, FKs cascade to
 *     children — so a purged Base also removes its tables, fields,
 *     records, views, forms, and dashboards.
 *
 *  2. **Zombie field-data cleanup**: when a field is soft-deleted but
 *     not yet purged, its data still lives in every record's `data`
 *     JSONB. This job strips those keys after the grace period — keeps
 *     records lean without losing the user's chance to undo. Only runs
 *     on fields whose tombstone is older than the grace period.
 *
 * Design choices:
 *  - Grace period is a parameter (default 30 days) so admins can dry-run
 *    with `gracePeriodDays: 0` to see the immediate effect.
 *  - Returns counts per entity type for logging/observability.
 *  - Hard-deletes via plain DELETE — FK cascades take care of children
 *    (records.table_id ON DELETE CASCADE, etc.).
 *  - Zombie-field stripping uses Postgres' `data - field_id` operator
 *    (returns the JSONB minus that key), so it's a single UPDATE per
 *    table rather than per-record.
 */
export type PurgeReport = {
  basesPurged: number;
  tablesPurged: number;
  fieldsPurged: number;
  recordsPurged: number;
  viewsPurged: number;
  formsPurged: number;
  dashboardsPurged: number;
  automationsPurged: number;
  automationRunsPurged: number;
  /** Number of records whose data lost zombie field-keys. */
  zombieFieldDataStripped: number;
};

/**
 * Hard-deletes everything tombstoned for longer than `gracePeriodDays`.
 * Strips zombie field-data from records owned by tables whose fields
 * crossed the grace line.
 *
 * Run order matters:
 *  1. Strip zombie field-data BEFORE purging the field rows — otherwise
 *     we'd lose the field-id-to-table mapping needed for the strip.
 *  2. Purge fields → records cascade-untouched (records survive).
 *  3. Purge records, views, forms, dashboards → leaves tables/bases.
 *  4. Purge tables → cascades to remaining children if any.
 *  5. Purge bases → cascades to tables.
 *
 * Safe to run repeatedly. Counts only reflect this run's deletions.
 */
export const purgeSoftDeleted = async (opts: {
  gracePeriodDays?: number;
  automationRunRetentionDays?: number;
} = {}): Promise<PurgeReport> => {
  const days = opts.gracePeriodDays ?? 30;
  const cutoff = sql`now() - (${days} || ' days')::interval`;
  const runRetentionDays = opts.automationRunRetentionDays ?? 90;
  const runCutoff = sql`now() - (${runRetentionDays} || ' days')::interval`;

  // ── 1. zombie field-data ────────────────────────────────────────────
  // For each field whose tombstone crossed the grace line, strip its
  // key from every record in its table. Tracks how many records were
  // touched so the report is meaningful.
  const zombieFields = await sql<{ id: string; table_id: string; type: string }[]>`
    SELECT id, table_id, type FROM grids.fields
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  let stripped = 0;
  for (const f of zombieFields) {
    const result = await sql`
      UPDATE grids.records
      SET data = data - ${f.id}, updated_at = now()
      WHERE table_id = ${f.table_id}::uuid AND data ? ${f.id}
    `;
    stripped += result.count ?? 0;
    // Tear down per-field DDL artefacts before the row goes away. All
    // calls are idempotent / IF EXISTS so a missing object is a no-op.
    await dropFieldIndex(f.id);
    await dropFieldUniqueIndex(f.id);
    if (f.type === "autonumber") await dropAutonumberSequence(f.id);
  }

  // ── 2-6. hard-purge per entity (FK CASCADE handles child rows) ──────
  const fieldsRes = await sql`
    DELETE FROM grids.fields
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const recordsRes = await sql`
    DELETE FROM grids.records
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const viewsRes = await sql`
    DELETE FROM grids.views
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const formsRes = await sql`
    DELETE FROM grids.forms
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const dashboardsRes = await sql`
    DELETE FROM grids.dashboards
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const automationsRes = await sql`
    DELETE FROM grids.automations
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const tablesRes = await sql`
    DELETE FROM grids.tables
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const basesRes = await sql`
    DELETE FROM grids.bases
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const automationRunsRes = await sql`
    DELETE FROM grids.automation_runs
    WHERE created_at < ${runCutoff}
  `;

  return {
    basesPurged: basesRes.count ?? 0,
    tablesPurged: tablesRes.count ?? 0,
    fieldsPurged: fieldsRes.count ?? 0,
    recordsPurged: recordsRes.count ?? 0,
    viewsPurged: viewsRes.count ?? 0,
    formsPurged: formsRes.count ?? 0,
    dashboardsPurged: dashboardsRes.count ?? 0,
    automationsPurged: automationsRes.count ?? 0,
    automationRunsPurged: automationRunsRes.count ?? 0,
    zombieFieldDataStripped: stripped,
  };
};
