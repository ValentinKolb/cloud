import { topic } from "@k2b/sync";
import { sql } from "bun";
import { logger } from "../services/logging";
import { toPgTextArray } from "../services/postgres";
import type { AiInvalidation, AiInvalidationDomain } from "./live-events";

const log = logger("ai:live-outbox");
const RETENTION_MS = 24 * 60 * 60 * 1_000;
const RECONCILE_INTERVAL_MS = 1_000;
const CLAIM_MS = 30_000;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 20;

type SqlClient = typeof sql;

export type AiLiveOutboxRow = {
  id: string;
  change_id: string;
  audience_user_id: string;
  conversation_short_id: string | null;
  project_short_id: string | null;
  domains: AiInvalidationDomain[];
  attempts: number;
  created_at: Date | string;
};

const invalidationTopic = topic<AiInvalidation>({
  id: "invalidations",
  prefix: "cloud:ai:events",
  retentionMs: RETENTION_MS,
  limits: { payloadBytes: 8_000 },
});

const tenantId = (userId: string): string => userId;

export const enqueueAiInvalidation = async (
  db: SqlClient,
  input: {
    audienceUserId: string;
    domains: AiInvalidationDomain[];
    conversationId?: string | null;
    projectId?: string | null;
    changeId?: string;
  },
): Promise<string> => {
  const [row] = await db<{ id: string }[]>`
    INSERT INTO ai.live_invalidation_outbox (
      change_id, audience_user_id, conversation_short_id, project_short_id, domains
    )
    VALUES (
      ${input.changeId ?? crypto.randomUUID()}::uuid,
      ${input.audienceUserId}::uuid,
      ${input.conversationId ?? null},
      ${input.projectId ?? null},
      ${toPgTextArray([...new Set(input.domains)])}::text[]
    )
    RETURNING id::text
  `;
  if (!row) throw new Error("AI live invalidation insert returned no id");
  return row.id;
};

const publishAiInvalidation = (row: AiLiveOutboxRow): Promise<unknown> => {
  const event: AiInvalidation = {
    type: "ai.invalidated",
    changeId: row.change_id,
    conversationId: row.conversation_short_id,
    projectId: row.project_short_id,
    domains: row.domains,
    at: new Date(row.created_at).toISOString(),
  };
  return invalidationTopic.pub({
    tenantId: tenantId(row.audience_user_id),
    orderingKey: row.conversation_short_id ?? row.project_short_id ?? row.audience_user_id,
    idempotencyKey: row.change_id,
    data: event,
  });
};

export const claimAiInvalidationBatch = async (limit = BATCH_SIZE): Promise<AiLiveOutboxRow[]> => {
  const cap = Math.min(Math.max(limit, 1), BATCH_SIZE);
  return sql.begin(
    (tx) =>
      tx<AiLiveOutboxRow[]>`
      WITH candidates AS MATERIALIZED (
        SELECT current.id
        FROM ai.live_invalidation_outbox current
        WHERE current.delivered_at IS NULL
          AND current.dead_at IS NULL
          AND current.next_attempt_at <= now()
          AND (current.claimed_until IS NULL OR current.claimed_until <= now())
          AND NOT EXISTS (
            SELECT 1
            FROM ai.live_invalidation_outbox earlier
            WHERE earlier.audience_user_id = current.audience_user_id
              AND earlier.delivered_at IS NULL
              AND earlier.dead_at IS NULL
              AND (earlier.created_at, earlier.id) < (current.created_at, current.id)
          )
        ORDER BY current.next_attempt_at, current.created_at, current.id
        LIMIT ${cap}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ai.live_invalidation_outbox outbox
      SET claimed_until = now() + (${CLAIM_MS} * interval '1 millisecond')
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING
        outbox.id::text,
        outbox.change_id::text,
        outbox.audience_user_id::text,
        outbox.conversation_short_id,
        outbox.project_short_id,
        outbox.domains,
        outbox.attempts,
        outbox.created_at
    `,
  );
};

export const dispatchAiInvalidation = async (
  row: AiLiveOutboxRow,
  publish: (row: AiLiveOutboxRow) => Promise<unknown> = publishAiInvalidation,
): Promise<void> => {
  try {
    await publish(row);
    await sql`
      UPDATE ai.live_invalidation_outbox
      SET delivered_at = now(), claimed_until = NULL, last_error = NULL
      WHERE id = ${row.id}::uuid AND delivered_at IS NULL AND dead_at IS NULL AND attempts = ${row.attempts}
    `;
  } catch (error) {
    const attempts = row.attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
    await sql`
      UPDATE ai.live_invalidation_outbox
      SET attempts = ${attempts},
          next_attempt_at = now() + (${delaySeconds} * interval '1 second'),
          claimed_until = NULL,
          dead_at = CASE WHEN ${attempts} >= ${MAX_ATTEMPTS} THEN now() ELSE dead_at END,
          last_error = ${message.slice(0, 1_000)}
      WHERE id = ${row.id}::uuid AND delivered_at IS NULL AND dead_at IS NULL AND attempts = ${row.attempts}
    `;
    log.warn("AI live invalidation delivery failed", {
      invalidationId: row.id,
      userId: row.audience_user_id,
      attempts,
      error: message,
    });
  }
};

let activeReconcile: Promise<number> | null = null;
let reconcileRequested = false;

export const reconcileAiInvalidations = (): Promise<number> => {
  reconcileRequested = true;
  if (activeReconcile) return activeReconcile;
  activeReconcile = (async () => {
    await sql`
      DELETE FROM ai.live_invalidation_outbox
      WHERE delivered_at < now() - interval '7 days'
         OR dead_at < now() - interval '30 days'
    `;
    let processed = 0;
    let rows: AiLiveOutboxRow[];
    do {
      reconcileRequested = false;
      rows = await claimAiInvalidationBatch();
      for (const row of rows) await dispatchAiInvalidation(row);
      processed += rows.length;
    } while (reconcileRequested || rows.length > 0);
    return processed;
  })().finally(() => {
    activeReconcile = null;
  });
  return activeReconcile;
};

export const notifyAiInvalidations = async (): Promise<void> => {
  await reconcileAiInvalidations().catch((error) => {
    log.warn("AI live invalidation reconcile failed", { error: error instanceof Error ? error.message : String(error) });
  });
};

let reconcileTimer: ReturnType<typeof setInterval> | null = null;

export const startAiInvalidationRuntime = (): void => {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => void notifyAiInvalidations(), RECONCILE_INTERVAL_MS);
  if (typeof reconcileTimer === "object" && "unref" in reconcileTimer) reconcileTimer.unref();
  void notifyAiInvalidations();
};

export const stopAiInvalidationRuntime = async (): Promise<void> => {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  await activeReconcile;
};

export const liveAiInvalidations = (input: { userId: string; after?: string | null; signal?: AbortSignal }) =>
  invalidationTopic.live({ tenantId: tenantId(input.userId), after: input.after ?? undefined, signal: input.signal });

export const latestAiInvalidationCursor = (userId: string): Promise<string | null> =>
  invalidationTopic.latestCursor({ tenantId: tenantId(userId) });
