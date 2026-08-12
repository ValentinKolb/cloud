import { topic } from "@k2b/sync";
import { logger } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type { MailInvalidation } from "../live-events";

const log = logger("mail:events");
const RETENTION_MS = 24 * 60 * 60 * 1_000;
const RECONCILE_INTERVAL_MS = 15_000;
const CLAIM_MS = 30_000;
const BATCH_SIZE = 100;

type SqlClient = typeof sql;

type LegacyConversationInvalidation = {
  mailboxId: string;
  conversationId: string;
  reason: string;
  targetId: string | null;
  activityId: string;
};

type LegacyMailboxInvalidation = {
  mailboxId: string;
  conversationId: null;
  reason: string;
  targetId: string | null;
  activityId: string;
};

export type MailConversationChangedEvent = LegacyConversationInvalidation;

export type MailMailboxChangedEvent = LegacyMailboxInvalidation;

export type MailCollaborationEvent = MailConversationChangedEvent | MailMailboxChangedEvent;

type OutboxRow = {
  id: string;
  mailbox_id: string;
  mailbox_short_id: string;
  conversation_id: string | null;
  conversation_short_id: string | null;
  attempts: number;
  created_at: Date | string;
};

const invalidationTopic = topic<MailInvalidation>({
  id: "invalidations",
  prefix: "cloud:mail:events",
  retentionMs: RETENTION_MS,
  limits: { payloadBytes: 8_000 },
});

export const enqueueMailInvalidation = async (
  db: SqlClient,
  params: { mailboxId: string; conversationId?: string | null },
): Promise<string> => {
  const [row] = await db<{ id: string }[]>`
    SELECT mail.enqueue_live_invalidation(
      ${params.mailboxId}::uuid,
      ${params.conversationId ?? null}::uuid
    )::text AS id
  `;
  if (!row) throw new Error("Mail live invalidation insert returned no id");
  return row.id;
};

const publishMailInvalidation = (row: OutboxRow): Promise<unknown> => {
  const event: MailInvalidation = {
    type: "mail.invalidated",
    mailboxId: row.mailbox_short_id,
    conversationId: row.conversation_short_id,
    changeId: row.id,
    at: new Date(row.created_at).toISOString(),
  };
  return invalidationTopic.pub({
    tenantId: row.mailbox_id,
    orderingKey: row.conversation_id ?? row.mailbox_id,
    idempotencyKey: event.changeId,
    data: event,
  });
};

export const claimMailInvalidationBatch = async (limit = BATCH_SIZE): Promise<OutboxRow[]> => {
  const cap = Math.min(Math.max(limit, 1), BATCH_SIZE);
  return sql.begin(async (tx) => {
    return tx<OutboxRow[]>`
      WITH candidates AS MATERIALIZED (
        SELECT id
        FROM mail.live_invalidation_outbox
        WHERE delivered_at IS NULL
          AND next_attempt_at <= now()
          AND (claimed_until IS NULL OR claimed_until <= now())
        ORDER BY next_attempt_at, created_at, id
        LIMIT ${cap}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE mail.live_invalidation_outbox outbox
      SET claimed_until = now() + (${CLAIM_MS} * interval '1 millisecond')
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING
        outbox.id::text,
        outbox.mailbox_id::text,
        outbox.mailbox_short_id,
        outbox.conversation_id::text,
        outbox.conversation_short_id,
        outbox.attempts,
        outbox.created_at
    `;
  });
};

export const dispatchMailInvalidation = async (
  row: OutboxRow,
  publish: (row: OutboxRow) => Promise<unknown> = publishMailInvalidation,
): Promise<void> => {
  try {
    await publish(row);
    await sql`
      UPDATE mail.live_invalidation_outbox
      SET delivered_at = now(), claimed_until = NULL, last_error = NULL
      WHERE id = ${row.id}::uuid
        AND delivered_at IS NULL
        AND attempts = ${row.attempts}
    `;
  } catch (error) {
    const attempts = row.attempts + 1;
    const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE mail.live_invalidation_outbox
      SET
        attempts = ${attempts},
        next_attempt_at = now() + (${delaySeconds} * interval '1 second'),
        claimed_until = NULL,
        last_error = ${message.slice(0, 1_000)}
      WHERE id = ${row.id}::uuid
        AND delivered_at IS NULL
        AND attempts = ${row.attempts}
    `;
    log.warn("Mail live invalidation delivery failed", {
      invalidationId: row.id,
      mailboxId: row.mailbox_id,
      attempts,
      error: message,
    });
  }
};

let activeReconcile: Promise<number> | null = null;
let reconcileRequested = false;

export const reconcileMailInvalidations = (): Promise<number> => {
  reconcileRequested = true;
  if (activeReconcile) return activeReconcile;
  activeReconcile = (async () => {
    await sql`
      DELETE FROM mail.live_invalidation_outbox
      WHERE delivered_at < now() - interval '7 days'
    `;
    let processed = 0;
    let rows: OutboxRow[];
    do {
      reconcileRequested = false;
      rows = await claimMailInvalidationBatch();
      await Promise.all(rows.map((row) => dispatchMailInvalidation(row)));
      processed += rows.length;
    } while (reconcileRequested || rows.length === BATCH_SIZE);
    return processed;
  })().finally(() => {
    activeReconcile = null;
  });
  return activeReconcile;
};

export const notifyMailInvalidations = async (): Promise<void> => {
  await reconcileMailInvalidations().catch((error) => {
    log.warn("Mail live invalidation reconcile failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

// Existing domain writers already insert an activity row in the same
// transaction. Until their call sites are reduced to notifyMailInvalidations,
// these adapters only wake the durable outbox dispatcher.
export const publishMailCollaborationEvent = async (_event: LegacyConversationInvalidation): Promise<void> => notifyMailInvalidations();

export const publishMailMailboxEvent = async (_event: LegacyMailboxInvalidation): Promise<void> => notifyMailInvalidations();

let reconcileTimer: ReturnType<typeof setInterval> | null = null;

export const startMailInvalidationRuntime = async (): Promise<void> => {
  if (reconcileTimer) return;
  await notifyMailInvalidations();
  reconcileTimer = setInterval(() => void notifyMailInvalidations(), RECONCILE_INTERVAL_MS);
};

export const stopMailInvalidationRuntime = async (): Promise<void> => {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  await activeReconcile;
};

export const liveMailInvalidations = (params: { mailboxId: string; after?: string | null; signal?: AbortSignal }) =>
  invalidationTopic.live({
    tenantId: params.mailboxId,
    after: params.after ?? undefined,
    signal: params.signal,
  });

export const latestMailInvalidationCursor = (mailboxId: string): Promise<string | null> =>
  invalidationTopic.latestCursor({ tenantId: mailboxId });
