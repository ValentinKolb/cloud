import { sql } from "bun";
import { logger, notifications } from "@valentinkolb/cloud/services";
import type { CreateWaypoint, Waypoint } from "@/contracts";
import type { MutationResult } from "./expeditions";

const log = logger("expeditions");

/**
 * Waypoint (= the items inside an expedition) CRUD.
 *
 * The interesting one is `setDone` — it updates the waypoint AND, if every
 * other waypoint is already done, marks the expedition as completed and
 * fires off a "you reached the summit" email to the creator via the
 * platform's `notifications.send` (which persists the message, attempts
 * SMTP delivery, and surfaces the result in the admin viewer at
 * `/admin/notifications`). The call is wrapped in try/catch so a failed
 * delivery never blocks the user's mutation.
 */

type DbWaypoint = {
  id: string;
  expedition_id: string;
  title: string;
  position: number;
  done_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const mapWaypoint = (row: DbWaypoint): Waypoint => ({
  id: row.id,
  expeditionId: row.expedition_id,
  title: row.title,
  position: row.position,
  doneAt: row.done_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

// ── Read ────────────────────────────────────────────────────────────────────

export const list = async (params: { expeditionId: string }): Promise<Waypoint[]> => {
  const rows = await sql<DbWaypoint[]>`
    SELECT id, expedition_id, title, position, done_at, created_at, updated_at
    FROM expeditions.waypoints
    WHERE expedition_id = ${params.expeditionId}::uuid
    ORDER BY position, created_at
  `;
  return rows.map(mapWaypoint);
};

export const get = async (params: { id: string }): Promise<Waypoint | null> => {
  const [row] = await sql<DbWaypoint[]>`
    SELECT id, expedition_id, title, position, done_at, created_at, updated_at
    FROM expeditions.waypoints
    WHERE id = ${params.id}::uuid
  `;
  return row ? mapWaypoint(row) : null;
};

// ── Mutate ──────────────────────────────────────────────────────────────────

/**
 * Append a waypoint to the end of the expedition.
 *
 * `position = (max existing) + 1` keeps insertion order — the detail view
 * just displays them in `ORDER BY position`. We don't bother with fractional
 * ranks here; reordering is out of scope for the demo.
 */
export const create = async (params: {
  expeditionId: string;
  data: CreateWaypoint;
}): Promise<MutationResult<Waypoint>> => {
  const [row] = await sql<DbWaypoint[]>`
    INSERT INTO expeditions.waypoints (expedition_id, title, position)
    VALUES (
      ${params.expeditionId}::uuid,
      ${params.data.title},
      COALESCE(
        (SELECT MAX(position) + 1 FROM expeditions.waypoints WHERE expedition_id = ${params.expeditionId}::uuid),
        0
      )
    )
    RETURNING id, expedition_id, title, position, done_at, created_at, updated_at
  `;
  if (!row) return { ok: false, error: "Failed to create waypoint", status: 500 };

  // A new (open) waypoint un-completes the expedition. Cheap to always run;
  // the WHERE makes it a no-op when the expedition isn't currently completed.
  await sql`
    UPDATE expeditions.expeditions
    SET completed_at = NULL, updated_at = now()
    WHERE id = ${params.expeditionId}::uuid AND completed_at IS NOT NULL
  `;

  log.info("waypoint.created", { expeditionId: params.expeditionId, waypointId: row.id });
  return { ok: true, data: mapWaypoint(row) };
};

export const remove = async (params: { id: string }): Promise<MutationResult<void>> => {
  // Capture the parent id before deleting — we may need to re-evaluate
  // whether the expedition is now fully completed (deleting the last open
  // waypoint can flip the expedition into completed state).
  const [existing] = await sql<{ expedition_id: string }[]>`
    SELECT expedition_id FROM expeditions.waypoints WHERE id = ${params.id}::uuid
  `;
  if (!existing) return { ok: false, error: "Waypoint not found", status: 404 };

  await sql`DELETE FROM expeditions.waypoints WHERE id = ${params.id}::uuid`;
  await reconcileCompletion(existing.expedition_id);
  return { ok: true, data: undefined };
};

/**
 * Tick a waypoint done / re-open it.
 *
 * After mutating the waypoint we reconcile the parent expedition's
 * `completed_at` field — and on a fresh completion (open → fully done) we
 * also send a notification email. The email path is best-effort: any
 * failure (SMTP down, no recipient address) is logged but doesn't
 * propagate, so the user's tick-off still succeeds.
 */
export const setDone = async (params: {
  id: string;
  done: boolean;
}): Promise<MutationResult<Waypoint>> => {
  const [row] = await sql<DbWaypoint[]>`
    UPDATE expeditions.waypoints
    SET done_at = ${params.done ? sql`now()` : null}, updated_at = now()
    WHERE id = ${params.id}::uuid
    RETURNING id, expedition_id, title, position, done_at, created_at, updated_at
  `;
  if (!row) return { ok: false, error: "Waypoint not found", status: 404 };

  await reconcileCompletion(row.expedition_id);
  return { ok: true, data: mapWaypoint(row) };
};

// ── Internal: completion reconciliation ─────────────────────────────────────

/**
 * Re-derives the expedition's `completed_at` from its waypoints. Called
 * after every waypoint mutation — kept as a separate function (not a
 * trigger) so the email side-effect lives next to the business logic.
 *
 * Behaviour:
 *   - 0 waypoints → expedition stays open (completed_at = NULL). Empty
 *     expeditions can't be "complete"; we'd send spurious mails otherwise.
 *   - all done    → set completed_at = now() if it wasn't already, send mail.
 *   - some open   → clear completed_at if it was set (re-opened).
 */
const reconcileCompletion = async (expeditionId: string): Promise<void> => {
  const [agg] = await sql<{ total: number; done: number }[]>`
    SELECT
      COUNT(*)::int                                       AS total,
      COUNT(*) FILTER (WHERE done_at IS NOT NULL)::int    AS done
    FROM expeditions.waypoints
    WHERE expedition_id = ${expeditionId}::uuid
  `;
  const total = agg?.total ?? 0;
  const done = agg?.done ?? 0;
  const fullyDone = total > 0 && total === done;

  // Capture the previous state so we know whether this transition is "newly
  // completed" — only then do we want to fire the email.
  const [prev] = await sql<{ completed_at: Date | null }[]>`
    SELECT completed_at FROM expeditions.expeditions
    WHERE id = ${expeditionId}::uuid
  `;
  const wasCompleted = prev?.completed_at != null;

  if (fullyDone && !wasCompleted) {
    await sql`
      UPDATE expeditions.expeditions
      SET completed_at = now(), updated_at = now()
      WHERE id = ${expeditionId}::uuid
    `;
    // Fire-and-forget mail. Any error is logged but never rethrown so the
    // user's mutation stays successful.
    notifyExpeditionCompleted(expeditionId).catch((e: Error) =>
      log.error("expedition.completion-mail.failed", {
        expeditionId,
        message: e.message,
      }),
    );
  } else if (!fullyDone && wasCompleted) {
    await sql`
      UPDATE expeditions.expeditions
      SET completed_at = NULL, updated_at = now()
      WHERE id = ${expeditionId}::uuid
    `;
    log.info("expedition.reopened", { expeditionId });
  }
};

/**
 * Send a "you reached the summit" email to the creator via the platform's
 * notifications service. `notifications.send` persists the message to
 * `notifications.messages`, attempts SMTP delivery, and records the result
 * — so the email also shows up in `/admin/notifications` for audit and
 * retry, without us doing anything extra.
 *
 * For the demo we keep it simple: only the creator gets notified. A real
 * app would resolve every member of every access entry (direct users +
 * group members) and call `notifications.send` for each one.
 */
const notifyExpeditionCompleted = async (expeditionId: string): Promise<void> => {
  const [row] = await sql<{ title: string; mail: string | null; display_name: string | null }[]>`
    SELECT
      e.title,
      u.mail,
      u.display_name
    FROM expeditions.expeditions e
    LEFT JOIN auth.users u ON u.id = e.created_by
    WHERE e.id = ${expeditionId}::uuid
  `;
  if (!row?.mail) {
    // No creator (or anonymous creation) — nothing to do but worth a log line.
    log.info("expedition.completed.no-recipient", { expeditionId, title: row?.title });
    return;
  }

  const greeting = row.display_name ? `Hi ${row.display_name},` : "Hi,";
  const content = [
    greeting,
    "",
    `🏁 You just completed the expedition "${row.title}". Every waypoint is checked off — congrats on reaching the summit!`,
    "",
    "— Your friendly expeditions app",
  ].join("\n");

  const result = await notifications.send({
    type: "email",
    recipient: row.mail,
    subject: `🏁 Expedition completed: ${row.title}`,
    content,
  });
  log.info("expedition.completed.mail-sent", {
    expeditionId,
    recipient: row.mail,
    notificationId: result.id,
    status: result.status,
  });
};
