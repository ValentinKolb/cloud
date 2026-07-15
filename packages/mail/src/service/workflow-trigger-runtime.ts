import { trace } from "@valentinkolb/cloud/services";
import { job } from "@valentinkolb/sync";
import { sql } from "bun";
import { getWorkflowSnapshot } from "./workflow-data";
import { withLeaseHeartbeat } from "./lease-heartbeat";
import { materializeAutomaticWorkflowRun } from "./workflow-materialization-service";

const TRIGGER_EVENT_JOB_ID = "mail:workflow-trigger-events:v1";
const TRIGGER_EVENT_LEASE_MS = 120_000;
const TRIGGER_EVENT_MAX_RETRIES = 5;
const TRIGGER_EVENT_HEARTBEAT_MS = Math.floor(TRIGGER_EVENT_LEASE_MS / 3);
const RECONCILE_LIMIT = 500;

type TriggerEventPayload = {
  remoteMessageRefId: string;
  messageContentId: string;
  conversationId: string | null;
};

type TriggerEventClaim = {
  id: string;
  mailboxId: string;
  triggerKind: string;
  deliveryKey: string;
  occurredAt: string;
  payload: TriggerEventPayload;
  generation: number;
  leaseToken: string;
};

type TriggerEventRow = {
  id: string;
  mailbox_id: string;
  trigger_kind: string;
  delivery_key: string;
  occurred_at: Date | string;
  payload: TriggerEventPayload | string;
  execution_generation: string | number;
  lease_token: string;
};

const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const errorInfo = (error: unknown) => ({
  code:
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "MAIL_WORKFLOW_TRIGGER_FAILED",
  message: error instanceof Error ? error.message : String(error),
  retryable: true,
});

const claimTriggerEvent = async (eventId: string, workerId: string): Promise<TriggerEventClaim | null> =>
  sql.begin(async (tx) => {
    const leaseToken = crypto.randomUUID();
    const [event] = await tx<TriggerEventRow[]>`
      UPDATE mail.workflow_trigger_events event
      SET
        state = 'running',
        execution_generation = event.execution_generation + 1,
        lease_owner = ${workerId},
        lease_token = ${leaseToken}::uuid,
        lease_expires_at = now() + (${TRIGGER_EVENT_LEASE_MS}::bigint * interval '1 millisecond'),
        started_at = COALESCE(event.started_at, now()),
        finished_at = NULL,
        last_error = NULL
      WHERE event.id = ${eventId}::uuid
        AND (
          event.state = 'queued'
          OR (event.state = 'running' AND event.lease_expires_at < now())
        )
      RETURNING
        event.id,
        event.mailbox_id,
        event.trigger_kind,
        event.delivery_key,
        event.occurred_at,
        event.payload,
        event.execution_generation,
        event.lease_token
    `;
    return event
      ? {
          id: event.id,
          mailboxId: event.mailbox_id,
          triggerKind: event.trigger_kind,
          deliveryKey: event.delivery_key,
          occurredAt: toIso(event.occurred_at),
          payload: parseJson(event.payload),
          generation: Number(event.execution_generation),
          leaseToken: event.lease_token,
        }
      : null;
  });

const releaseTriggerEvent = async (claim: TriggerEventClaim, error: unknown): Promise<void> => {
  await sql`
    UPDATE mail.workflow_trigger_events
    SET
      state = 'queued',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error = ${errorInfo(error)}::jsonb
    WHERE id = ${claim.id}::uuid
      AND state = 'running'
      AND execution_generation = ${claim.generation}
      AND lease_token = ${claim.leaseToken}::uuid
  `;
};

const renewTriggerEvent = async (claim: TriggerEventClaim): Promise<void> => {
  const renewed = await sql`
    UPDATE mail.workflow_trigger_events
    SET lease_expires_at = now() + (${TRIGGER_EVENT_LEASE_MS}::bigint * interval '1 millisecond')
    WHERE id = ${claim.id}::uuid
      AND state = 'running'
      AND execution_generation = ${claim.generation}
      AND lease_token = ${claim.leaseToken}::uuid
  `;
  if (renewed.count !== 1) throw new Error("Mail workflow trigger event lease was lost");
};

const finishTriggerEvent = async (
  claim: TriggerEventClaim,
  result: { activations: number; created: number; existing: number; skipped: number },
): Promise<void> => {
  const update = await sql`
    UPDATE mail.workflow_trigger_events
    SET
      state = 'succeeded',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      result = ${result}::jsonb,
      last_error = NULL,
      finished_at = now()
    WHERE id = ${claim.id}::uuid
      AND state = 'running'
      AND execution_generation = ${claim.generation}
      AND lease_token = ${claim.leaseToken}::uuid
  `;
  if (update.count !== 1) throw new Error("Mail workflow trigger event lease was lost before completion");
};

const failTriggerEvent = async (eventId: string, error: unknown): Promise<void> => {
  await sql`
    UPDATE mail.workflow_trigger_events
    SET state = 'failed', last_error = ${errorInfo(error)}::jsonb, finished_at = now()
    WHERE id = ${eventId}::uuid AND state = 'queued'
  `;
};

export const processMailWorkflowTriggerEvent = async (
  eventId: string,
  workerId: string,
  jobHeartbeat: () => Promise<void> = async () => undefined,
): Promise<void> => {
  const claim = await claimTriggerEvent(eventId, workerId);
  if (!claim) return;
  try {
    await withLeaseHeartbeat({
      intervalMs: TRIGGER_EVENT_HEARTBEAT_MS,
      heartbeat: async () => {
        await jobHeartbeat();
        await renewTriggerEvent(claim);
      },
      work: async (assertLeaseActive) => {
        if (claim.triggerKind !== "messageReceived") throw new Error(`Unsupported Mail workflow trigger event ${claim.triggerKind}`);
        const snapshot = await getWorkflowSnapshot({
          mailboxId: claim.mailboxId,
          remoteMessageRefId: claim.payload.remoteMessageRefId,
          query: { type: "all" },
        });
        const activations = await sql<{ id: string }[]>`
          SELECT activation.id
          FROM mail.workflow_activations activation
          JOIN mail.workflows workflow
            ON workflow.id = activation.workflow_id
           AND workflow.mailbox_id = activation.mailbox_id
           AND workflow.active_version_id = activation.workflow_version_id
          WHERE activation.mailbox_id = ${claim.mailboxId}::uuid
            AND activation.trigger_kind = ${claim.triggerKind}
            AND activation.enabled
          ORDER BY workflow.priority, activation.workflow_id, activation.id
        `;
        const result = { activations: activations.length, created: 0, existing: 0, skipped: 0 };
        for (const activation of activations) {
          await assertLeaseActive();
          if (!snapshot) {
            result.skipped += 1;
            continue;
          }
          const materialized = await materializeAutomaticWorkflowRun({
            activationId: activation.id,
            triggerKind: claim.triggerKind,
            deliveryKey: claim.deliveryKey,
            occurredAt: claim.occurredAt,
            channel: "event",
            triggerValues: {
              message: snapshot.source.message,
              conversation: snapshot.source.conversation,
              occurredAt: claim.occurredAt,
            },
            target: {
              key: snapshot.targetKey,
              source: snapshot.source,
              preconditions: snapshot.preconditions,
            },
          });
          result[materialized.state] += 1;
        }
        await assertLeaseActive();
        await finishTriggerEvent(claim, result);
      },
    });
  } catch (error) {
    await releaseTriggerEvent(claim, error);
    throw error;
  }
};

const triggerEventJob = job<{ eventId: string }>({
  id: TRIGGER_EVENT_JOB_ID,
  defaults: { leaseMs: TRIGGER_EVENT_LEASE_MS, keyTtlMs: 7 * 24 * 60 * 60_000 },
  trace: trace.fromSyncJob({
    name: "Mail workflow trigger event",
    source: TRIGGER_EVENT_JOB_ID,
    appId: "mail",
    attributes: (event) => ("input" in event && event.input ? { "cloud.mail.workflow_trigger_event_id": event.input.eventId } : {}),
  }),
  process: async ({ ctx }) => processMailWorkflowTriggerEvent(ctx.input.eventId, ctx.jobId, () => ctx.heartbeat()),
  after: async ({ ctx }) => {
    if (!ctx.error) return;
    if (ctx.failureCount < TRIGGER_EVENT_MAX_RETRIES) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 2_000, maxMs: 60_000 }) });
      return;
    }
    await failTriggerEvent(ctx.input.eventId, ctx.error);
  },
});

export const enqueueMailWorkflowTriggerEvent = async (eventId: string): Promise<void> => {
  await triggerEventJob.submit({ key: `event:${eventId}`, input: { eventId }, leaseMs: TRIGGER_EVENT_LEASE_MS });
};

export const reconcileMailWorkflowTriggerEvents = async (): Promise<number> => {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM mail.workflow_trigger_events
    WHERE state = 'queued'
       OR (state = 'running' AND lease_expires_at < now())
    ORDER BY occurred_at, id
    LIMIT ${RECONCILE_LIMIT}
  `;
  await Promise.all(rows.map((row) => enqueueMailWorkflowTriggerEvent(row.id)));
  return rows.length;
};

export const stopMailWorkflowTriggerRuntime = (): void => triggerEventJob.stop();
