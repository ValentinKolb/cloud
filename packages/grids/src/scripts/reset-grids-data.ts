/**
 * Local-dev helper: wipes ALL grids application data while leaving the
 * schema (tables, indexes, constraints) and other apps' data intact.
 *
 * Use case: v3 changed how relations are stored (record_links junction
 * instead of JSONB arrays). Existing local records still carry stale
 * relation arrays in `data`, which the new read path simply ignores —
 * leaving orphan keys clutter. Running this script gives you a clean
 * slate without dropping the whole database.
 *
 * What it deletes (in dependency order):
 *  - record_links (junction)
 *  - records       (CASCADE removes any remaining links)
 *  - audit_log     (table_id-scoped entries — full table is fine)
 *  - forms         (CASCADE: form_access removed via auth.access junctions)
 *  - views
 *  - fields
 *  - tables
 *  - bases         (CASCADE removes table_access, base_access junctions)
 *
 * What it preserves: the schema itself, auth.users, auth.access, every
 * other app's data. Idempotent — safe to run multiple times.
 *
 * Usage: `bun run packages/grids/src/scripts/reset-grids-data.ts`
 */
import { sql } from "bun";

const main = async () => {
  console.log("⚠ Resetting grids application data...");
  // TRUNCATE with CASCADE is faster than DELETE and resets sequences,
  // but it errors if any of the listed tables has FKs from outside
  // the listed set. We list every grids table so the cascade is
  // self-contained.
  await sql`
    TRUNCATE
      grids.record_links,
      grids.records,
      grids.audit_log,
      grids.forms,
      grids.views,
      grids.view_access,
      grids.fields,
      grids.tables,
      grids.table_access,
      grids.bases,
      grids.base_access
    CASCADE
  `.simple();
  console.log("✓ All grids data wiped. Schema and other apps untouched.");
  // Caller must close the connection — Bun-sql doesn't auto-close.
  await sql.end();
};

await main();
