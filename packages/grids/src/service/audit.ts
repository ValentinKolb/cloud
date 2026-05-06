import { sql } from "bun";
import { parseJsonbRow } from "./jsonb";
import type { AuditAction, AuditEntry } from "./types";

type DbRow = Record<string, unknown>;

const mapRow = (row: DbRow): AuditEntry => ({
  id: row.id as string,
  baseId: (row.base_id as string | null) ?? null,
  tableId: (row.table_id as string | null) ?? null,
  recordId: (row.record_id as string | null) ?? null,
  userId: (row.user_id as string | null) ?? null,
  action: row.action as AuditAction,
  diff: parseJsonbRow<AuditEntry["diff"]>(row.diff, null),
  ip: (row.ip as string | null) ?? null,
  userAgent: (row.user_agent as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
});

export type LogAuditInput = {
  baseId?: string | null;
  tableId?: string | null;
  recordId?: string | null;
  userId?: string | null;
  action: AuditAction;
  diff?: AuditEntry["diff"];
  ip?: string | null;
  userAgent?: string | null;
};

export const logAudit = async (input: LogAuditInput): Promise<void> => {
  await sql`
    INSERT INTO grids.audit_log (base_id, table_id, record_id, user_id, action, diff, ip, user_agent)
    VALUES (
      ${input.baseId ?? null}::uuid,
      ${input.tableId ?? null}::uuid,
      ${input.recordId ?? null}::uuid,
      ${input.userId ?? null}::uuid,
      ${input.action},
      ${input.diff ?? null}::jsonb,
      ${input.ip ?? null},
      ${input.userAgent ?? null}
    )
  `;
};

export type AuditEntryWithUser = AuditEntry & {
  /** Display name resolved from auth.users; null when the actor is
   *  unknown (anonymous form submission or deleted user). */
  userDisplayName: string | null;
};

/**
 * Per-record audit history with the actor's display name resolved.
 * Used by the record detail panel's History tab — the join keeps the
 * UI from having to fetch users separately.
 */
export const listByRecord = async (
  recordId: string,
  limit = 50,
): Promise<AuditEntryWithUser[]> => {
  const cap = Math.min(Math.max(limit, 1), 200);
  const rows = await sql<(DbRow & { user_display_name: string | null })[]>`
    SELECT al.id, al.base_id, al.table_id, al.record_id, al.user_id, al.action,
           al.diff, al.ip, al.user_agent, al.created_at,
           COALESCE(u.uid, NULL) AS user_display_name
    FROM grids.audit_log al
    LEFT JOIN auth.users u ON u.id = al.user_id
    WHERE al.record_id = ${recordId}::uuid
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT ${cap}
  `;
  return rows.map((row) => ({
    ...mapRow(row),
    userDisplayName: (row.user_display_name as string | null) ?? null,
  }));
};

/**
 * Audit-log IDs are gen_random_uuid() — not time-ordered — so pagination
 * uses (created_at DESC, id DESC) tuple cursor: rows with the same instant
 * get a deterministic id tiebreaker so we never skip or reorder history.
 * Cursor format: "<ISO timestamp>|<uuid>".
 */
export const listAudit = async (params: {
  tableId?: string;
  recordId?: string;
  limit?: number;
  cursor?: string | null;
}): Promise<{ items: AuditEntry[]; nextCursor: string | null }> => {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const conditions: any[] = [sql`TRUE`];
  if (params.tableId) conditions.push(sql`table_id = ${params.tableId}::uuid`);
  if (params.recordId) conditions.push(sql`record_id = ${params.recordId}::uuid`);
  if (params.cursor) {
    const sep = params.cursor.indexOf("|");
    if (sep > 0) {
      const ts = params.cursor.slice(0, sep);
      const id = params.cursor.slice(sep + 1);
      conditions.push(sql`(created_at, id) < (${ts}::timestamptz, ${id}::uuid)`);
    }
  }
  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  // The cursor token is built in Postgres so it carries the same full
  // timestamp precision the WHERE clause compares against — JS Date
  // millisecond-truncation would otherwise let rows slip between pages.
  const rows = await sql<(DbRow & { cursor_token: string })[]>`
    SELECT id, base_id, table_id, record_id, user_id, action, diff, ip, user_agent, created_at,
           (created_at::text || '|' || id::text) AS cursor_token
    FROM grids.audit_log
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(mapRow);
  const lastRow = rows[items.length - 1];
  const nextCursor = hasMore && lastRow ? lastRow.cursor_token : null;
  return { items, nextCursor };
};
