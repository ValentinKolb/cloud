import { sql } from "bun";

/**
 * Database migrations for the expeditions app.
 *
 * Runs idempotently on every container startup (`lifecycle.setup` in index.ts).
 * Two tables, one junction:
 *
 *   expeditions.expeditions       — the tenancy entity (a "journey" with a goal)
 *   expeditions.waypoints         — items within an expedition (steps to tick off)
 *   expeditions.expedition_access — junction → auth.access (members + permissions)
 *
 * Schema is namespaced (`expeditions.*`) so it never collides with tables
 * owned by other apps. The `auth.access` row carries the actual permission
 * (read / write / admin); the junction just links a row to a resource.
 */
export const migrate = async (): Promise<void> => {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.simple();

  await sql`CREATE SCHEMA IF NOT EXISTS expeditions`.simple();
  console.log("  ✓ expeditions schema");

  // ── Expedition (tenancy entity) ─────────────────────────────────────────
  // `completed_at` is a derived denormalisation: it's set when the last
  // waypoint is ticked off, cleared when a previously-done waypoint is
  // unticked. Lets the list view show progress without re-aggregating.
  await sql`
    CREATE TABLE IF NOT EXISTS expeditions.expeditions (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title        TEXT NOT NULL,
      description  TEXT,
      icon         TEXT NOT NULL DEFAULT 'ti ti-map-2',
      completed_at TIMESTAMPTZ,
      created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ expeditions.expeditions table");

  // ── Access junction → auth.access ───────────────────────────────────────
  // Same pattern as spaces.space_access / notebooks.notebook_access. The row
  // in auth.access carries the principal (user / group / authenticated /
  // public) plus the permission level; this junction just attaches it to a
  // specific expedition. Cascades on both sides — deleting the expedition or
  // the access entry cleans up the link automatically.
  await sql`
    CREATE TABLE IF NOT EXISTS expeditions.expedition_access (
      expedition_id UUID NOT NULL REFERENCES expeditions.expeditions(id) ON DELETE CASCADE,
      access_id     UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (expedition_id, access_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_expedition_access_access
    ON expeditions.expedition_access(access_id)
  `.simple();
  console.log("  ✓ expeditions.expedition_access table");

  // ── Waypoints (items within an expedition) ──────────────────────────────
  // `position` keeps the user-defined order (drag-handle-ready, even though
  // this template doesn't ship reordering). `done_at` doubles as a boolean
  // and a timestamp; null = open, set = done. We index (expedition_id,
  // position) so the detail view's ordered list is a single index scan.
  await sql`
    CREATE TABLE IF NOT EXISTS expeditions.waypoints (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      expedition_id UUID NOT NULL REFERENCES expeditions.expeditions(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      position      INT  NOT NULL DEFAULT 0,
      done_at       TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_waypoints_expedition_position
    ON expeditions.waypoints(expedition_id, position)
  `.simple();
  console.log("  ✓ expeditions.waypoints table");
};
