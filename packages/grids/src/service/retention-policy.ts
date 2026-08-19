import { sql } from "bun";
import type { RetentionPolicyInput, RetentionPreview } from "../retention-policy-contracts";
import { RETENTION_PREVIEW_LIMIT } from "../retention-policy-contracts";
import { logAudit } from "./audit";

type Policy = { minimumDays: number; updatedAt: string };

export const get = async (baseId: string): Promise<Policy | null> => {
  const [row] = await sql<Array<{ minimum_days: number; updated_at: Date | string }>>`
    SELECT minimum_days, updated_at FROM grids.retention_policies WHERE base_id = ${baseId}::uuid
  `;
  return row ? { minimumDays: Number(row.minimum_days), updatedAt: new Date(row.updated_at).toISOString() } : null;
};

export const update = async (baseId: string, input: RetentionPolicyInput, actorId: string | null): Promise<Policy> =>
  sql.begin(async (tx) => {
    await tx`SELECT id FROM grids.bases WHERE id = ${baseId}::uuid FOR UPDATE`;
    const [previous] = await tx<Array<{ minimum_days: number }>>`
      SELECT minimum_days FROM grids.retention_policies WHERE base_id = ${baseId}::uuid FOR UPDATE
    `;
    const [row] = await tx<Array<{ minimum_days: number; updated_at: Date | string }>>`
      INSERT INTO grids.retention_policies (base_id, minimum_days, updated_by)
      VALUES (${baseId}::uuid, ${input.minimumDays}, ${actorId}::uuid)
      ON CONFLICT (base_id) DO UPDATE SET minimum_days = EXCLUDED.minimum_days, updated_by = EXCLUDED.updated_by, updated_at = now()
      RETURNING minimum_days, updated_at
    `;
    if (!row) throw new Error("Retention policy update returned no row");
    await logAudit(
      {
        baseId,
        userId: actorId,
        action: "retention_policy.updated",
        diff: { minimumDays: { old: previous ? Number(previous.minimum_days) : null, new: Number(row.minimum_days) } },
      },
      tx,
    );
    return { minimumDays: Number(row.minimum_days), updatedAt: new Date(row.updated_at).toISOString() };
  });

export const remove = async (baseId: string, actorId: string | null): Promise<boolean> =>
  sql.begin(async (tx) => {
    await tx`SELECT id FROM grids.bases WHERE id = ${baseId}::uuid FOR UPDATE`;
    const [removed] = await tx<Array<{ minimum_days: number }>>`
      DELETE FROM grids.retention_policies WHERE base_id = ${baseId}::uuid RETURNING minimum_days
    `;
    if (!removed) return false;
    await logAudit(
      {
        baseId,
        userId: actorId,
        action: "retention_policy.removed",
        diff: { minimumDays: { old: Number(removed.minimum_days), new: null } },
      },
      tx,
    );
    return true;
  });

export const preview = async (baseId: string, input: RetentionPolicyInput): Promise<RetentionPreview> => {
  const [observed] = await sql<Array<{ observed_at: Date }>>`SELECT now() AS observed_at`;
  if (!observed) throw new Error("Could not establish retention preview time");
  const observedAt = observed.observed_at.toISOString();
  const [counts] = await sql<Array<{ trashed: number; reached: number; later: number; finalized: number }>>`
    SELECT count(*)::int AS trashed,
      count(*) FILTER (WHERE record.finalized_at IS NULL AND record.deleted_at + (${input.minimumDays} * interval '1 day') <= ${observedAt}::timestamptz)::int AS reached,
      count(*) FILTER (WHERE record.finalized_at IS NULL AND record.deleted_at + (${input.minimumDays} * interval '1 day') > ${observedAt}::timestamptz)::int AS later,
      count(*) FILTER (WHERE record.finalized_at IS NOT NULL)::int AS finalized
    FROM grids.records record JOIN grids.tables table_info ON table_info.id = record.table_id
    WHERE table_info.base_id = ${baseId}::uuid AND record.deleted_at IS NOT NULL
  `;
  const examples = await sql<Array<{ record_id: string; table_id: string; deleted_at: Date; not_before: Date }>>`
    SELECT record.short_id AS record_id, table_info.short_id AS table_id, record.deleted_at,
      record.deleted_at + (${input.minimumDays} * interval '1 day') AS not_before
    FROM grids.records record JOIN grids.tables table_info ON table_info.id = record.table_id
    WHERE table_info.base_id = ${baseId}::uuid AND record.deleted_at IS NOT NULL AND record.finalized_at IS NULL
    ORDER BY not_before, record.id LIMIT ${RETENTION_PREVIEW_LIMIT}
  `;
  const values = counts ?? { trashed: 0, reached: 0, later: 0, finalized: 0 };
  return {
    observedAt,
    minimumDays: input.minimumDays,
    counts: {
      trashedRecords: Number(values.trashed),
      floorReached: Number(values.reached),
      retainedUntilLater: Number(values.later),
      protectedFinalized: Number(values.finalized),
    },
    examples: examples.map((row) => ({
      recordId: row.record_id,
      tableId: row.table_id,
      deletedAt: row.deleted_at.toISOString(),
      notBefore: row.not_before.toISOString(),
    })),
    truncated: Number(values.reached) + Number(values.later) > examples.length,
  };
};
