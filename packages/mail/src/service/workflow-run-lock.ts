import type { SqlClient } from "./workflow-data";

/** Serializes target publication with control snapshots for one workflow run. */
export const lockWorkflowRunControl = async (
  db: SqlClient,
  runId: string
): Promise<void> => {
  await db`SELECT pg_advisory_xact_lock(hashtextextended(${`mail.workflow.run.control:${runId}`}, 0))`;
};
