import { sql } from "bun";

const COMPLETED_RETENTION_MS = 24 * 60 * 60_000;
const CHECKPOINT_RECOVERY_MS = 5 * 60_000;

export const cleanupProviderOAuthFlows = async (): Promise<number> => {
  const recovered = await sql<{ id: string }[]>`
    UPDATE mail.provider_oauth_flows
    SET
      status = 'completed',
      result_code = 'PARTIAL',
      result_message = 'Provider connected; mailbox setup still requires attention',
      completed_at = now(),
      encrypted_code_verifier = 'destroyed',
      updated_at = now()
    WHERE status = 'exchanging'
      AND result_connection_id IS NOT NULL
      AND updated_at < now() - ${CHECKPOINT_RECOVERY_MS} * interval '1 millisecond'
    RETURNING id
  `;
  const rows = await sql<{ id: string }[]>`
    WITH expired AS (
      SELECT id
      FROM mail.provider_oauth_flows
      WHERE (completed_at IS NULL AND expires_at < now())
         OR (completed_at IS NOT NULL AND completed_at < now() - ${COMPLETED_RETENTION_MS} * interval '1 millisecond')
      ORDER BY expires_at, id
      LIMIT 1000
    )
    DELETE FROM mail.provider_oauth_flows flow
    USING expired
    WHERE flow.id = expired.id
    RETURNING flow.id
  `;
  return recovered.length + rows.length;
};
