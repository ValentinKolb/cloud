import { err, fail, ok, type Result } from "@k2b/stdlib";
import { sql } from "bun";
import type { PreservationHold, PreservationHoldInput } from "../preservation-hold-contracts";
import { logAudit, type SqlClient } from "./audit";
import { newShortId } from "./short-id";

type HoldRow = {
  id: string;
  short_id: string;
  base_short_id: string;
  reason: string;
  created_by_display_name: string | null;
  created_at: Date | string;
  release_reason: string | null;
  released_by_display_name: string | null;
  released_at: Date | string | null;
};

const toHold = (row: HoldRow): PreservationHold => ({
  id: row.short_id,
  baseId: row.base_short_id,
  reason: row.reason,
  status: row.released_at === null ? "active" : "released",
  createdByDisplayName: row.created_by_display_name,
  createdAt: new Date(row.created_at).toISOString(),
  releaseReason: row.release_reason,
  releasedByDisplayName: row.released_by_display_name,
  releasedAt: row.released_at === null ? null : new Date(row.released_at).toISOString(),
});

const projection = sql`
  hold.id, hold.short_id, base.short_id AS base_short_id, hold.reason,
  hold.created_by_display_name, hold.created_at, hold.release_reason,
  hold.released_by_display_name, hold.released_at
`;

export const list = async (
  baseId: string,
  input: { status: "active" | "released" | "all"; perPage: number; offset: number },
): Promise<{ items: PreservationHold[]; total: number }> => {
  const [count] = await sql<Array<{ total: number }>>`
    SELECT count(*)::int AS total
    FROM grids.preservation_holds hold
    WHERE hold.base_id = ${baseId}::uuid
      AND (${input.status} = 'all'
        OR (${input.status} = 'active' AND hold.released_at IS NULL)
        OR (${input.status} = 'released' AND hold.released_at IS NOT NULL))
  `;
  const rows = await sql<HoldRow[]>`
    SELECT ${projection}
    FROM grids.preservation_holds hold
    JOIN grids.bases base ON base.id = hold.base_id
    WHERE hold.base_id = ${baseId}::uuid
      AND (${input.status} = 'all'
        OR (${input.status} = 'active' AND hold.released_at IS NULL)
        OR (${input.status} = 'released' AND hold.released_at IS NOT NULL))
    ORDER BY hold.created_at DESC, hold.id DESC
    LIMIT ${input.perPage} OFFSET ${input.offset}
  `;
  return { items: rows.map(toHold), total: Number(count?.total ?? 0) };
};

export const create = async (
  baseId: string,
  input: PreservationHoldInput,
  actor: { id: string | null; displayName: string | null },
): Promise<PreservationHold> =>
  sql.begin(async (tx) => {
    await tx`SELECT id FROM grids.bases WHERE id = ${baseId}::uuid FOR UPDATE`;
    const shortId = newShortId();
    const [row] = await tx<HoldRow[]>`
      INSERT INTO grids.preservation_holds (
        short_id, base_id, reason, created_by, created_by_display_name
      )
      SELECT ${shortId}, base.id, ${input.reason}, ${actor.id}::uuid, ${actor.displayName}
      FROM grids.bases base WHERE base.id = ${baseId}::uuid
      RETURNING id, short_id, (SELECT short_id FROM grids.bases WHERE id = base_id) AS base_short_id,
        reason, created_by_display_name, created_at, release_reason, released_by_display_name, released_at
    `;
    if (!row) throw new Error("Preservation hold creation returned no row");
    await logAudit(
      {
        baseId,
        userId: actor.id,
        action: "preservation_hold.created",
        diff: { holdId: { old: null, new: row.short_id }, reason: { old: null, new: row.reason } },
      },
      tx,
    );
    return toHold(row);
  });

export const release = async (
  baseId: string,
  holdPublicId: string,
  input: PreservationHoldInput,
  actor: { id: string | null; displayName: string | null },
): Promise<Result<PreservationHold>> =>
  sql.begin(async (tx) => {
    await tx`SELECT id FROM grids.bases WHERE id = ${baseId}::uuid FOR UPDATE`;
    const [current] = await tx<Array<{ released_at: Date | string | null }>>`
      SELECT released_at FROM grids.preservation_holds
      WHERE base_id = ${baseId}::uuid AND short_id = ${holdPublicId}
      FOR UPDATE
    `;
    if (!current) return fail(err.notFound("Preservation hold not found"));
    if (current.released_at !== null) return fail(err.conflict("Preservation hold is already released"));
    const [row] = await tx<HoldRow[]>`
      UPDATE grids.preservation_holds hold
      SET release_reason = ${input.reason}, released_by = ${actor.id}::uuid,
        released_by_display_name = ${actor.displayName}, released_at = now()
      FROM grids.bases base
      WHERE hold.short_id = ${holdPublicId} AND hold.base_id = ${baseId}::uuid
        AND hold.released_at IS NULL AND base.id = hold.base_id
      RETURNING hold.id, hold.short_id, base.short_id AS base_short_id, hold.reason,
        hold.created_by_display_name, hold.created_at, hold.release_reason,
        hold.released_by_display_name, hold.released_at
    `;
    if (!row) throw new Error("Preservation hold release returned no row");
    await logAudit(
      {
        baseId,
        userId: actor.id,
        action: "preservation_hold.released",
        diff: { holdId: { old: row.short_id, new: null }, releaseReason: { old: null, new: row.release_reason } },
      },
      tx,
    );
    return ok(toHold(row));
  });

/** Call inside the same transaction that would destroy Base evidence. */
export const admitDestruction = async (baseId: string, client: SqlClient): Promise<Result<void>> => {
  await client`SELECT id FROM grids.bases WHERE id = ${baseId}::uuid FOR UPDATE`;
  const [hold] = await client<Array<{ short_id: string }>>`
    SELECT short_id FROM grids.preservation_holds
    WHERE base_id = ${baseId}::uuid AND released_at IS NULL
    ORDER BY created_at, id LIMIT 1
  `;
  return hold ? fail(err.conflict(`Controlled destruction is blocked by active preservation hold ${hold.short_id}`)) : ok(undefined);
};
