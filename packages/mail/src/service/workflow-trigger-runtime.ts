import { createRuntimeTaskTracker, stopRuntimeJobs, trace } from "@valentinkolb/cloud/services";
import { job } from "@valentinkolb/sync";
import { sql } from "bun";
import { withLeaseHeartbeat } from "./lease-heartbeat";
import {
  type AutomaticWorkflowActivationSnapshot,
  type AutomaticWorkflowMaterializationInput,
  materializeAutomaticWorkflowRun,
} from "./workflow-automatic-materialization";
import { enqueueWorkflowRun } from "./workflow-runtime";

const TRIGGER_EVENT_JOB_ID = "mail:workflow-trigger-events:v1";
const TRIGGER_EVENT_LEASE_MS = 120_000;
const TRIGGER_EVENT_MAX_RETRIES = 5;
const TRIGGER_EVENT_HEARTBEAT_MS = Math.floor(TRIGGER_EVENT_LEASE_MS / 3);
const RECONCILE_LIMIT = 500;
const triggerEventTasks = createRuntimeTaskTracker();

type TriggerEventClaim = {
  id: string;
  activation: AutomaticWorkflowActivationSnapshot;
  triggerKind: string;
  deliveryKey: string;
  occurredAt: string;
  triggerValues: AutomaticWorkflowMaterializationInput["triggerValues"];
  target: AutomaticWorkflowMaterializationInput["target"];
  generation: number;
  leaseToken: string;
};

type TriggerEventRow = {
  id: string;
  mailbox_id: string;
  activation_id: string;
  workflow_id: string;
  workflow_version_id: string;
  trigger_key: string;
  trigger_kind: string;
  trigger_config: AutomaticWorkflowActivationSnapshot["triggerConfig"] | string;
  authorization_snapshot: AutomaticWorkflowActivationSnapshot["authorizationSnapshot"] | string;
  version_identity: string;
  workflow_source_hash: string;
  bound_plan: AutomaticWorkflowActivationSnapshot["boundPlan"] | string;
  effect_budget: AutomaticWorkflowActivationSnapshot["effectBudget"] | string;
  manifest_hash: string;
  catalog_hash: string;
  delivery_key: string;
  occurred_at: Date | string;
  trigger_values: AutomaticWorkflowMaterializationInput["triggerValues"] | string;
  target_key: string;
  frozen_source: AutomaticWorkflowMaterializationInput["target"]["source"] | string;
  frozen_preconditions: AutomaticWorkflowMaterializationInput["target"]["preconditions"] | string;
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
        event.activation_id,
        event.workflow_id,
        event.workflow_version_id,
        event.trigger_key,
        event.trigger_kind,
        event.trigger_config,
        event.authorization_snapshot,
        event.version_identity,
        event.workflow_source_hash,
        event.bound_plan,
        event.effect_budget,
        event.manifest_hash,
        event.catalog_hash,
        event.delivery_key,
        event.occurred_at,
        event.trigger_values,
        event.target_key,
        event.frozen_source,
        event.frozen_preconditions,
        event.execution_generation,
        event.lease_token
    `;
    return event
      ? {
          id: event.id,
          activation: {
            activationId: event.activation_id,
            mailboxId: event.mailbox_id,
            workflowId: event.workflow_id,
            workflowVersionId: event.workflow_version_id,
            triggerKey: event.trigger_key,
            triggerKind: event.trigger_kind,
            triggerConfig: parseJson(event.trigger_config),
            authorizationSnapshot: parseJson(event.authorization_snapshot),
            versionIdentity: event.version_identity,
            sourceHash: event.workflow_source_hash,
            boundPlan: parseJson(event.bound_plan),
            effectBudget: parseJson(event.effect_budget),
            manifestHash: event.manifest_hash,
            catalogHash: event.catalog_hash,
          },
          triggerKind: event.trigger_kind,
          deliveryKey: event.delivery_key,
          occurredAt: toIso(event.occurred_at),
          triggerValues: parseJson(event.trigger_values),
          target: {
            key: event.target_key,
            source: parseJson(event.frozen_source),
            preconditions: parseJson(event.frozen_preconditions),
          },
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
        const result = { activations: 1, created: 0, existing: 0, skipped: 0 };
        await assertLeaseActive();
        const materialized = await materializeAutomaticWorkflowRun(
          {
            activation: claim.activation,
            triggerKind: claim.triggerKind,
            deliveryKey: claim.deliveryKey,
            occurredAt: claim.occurredAt,
            channel: "event",
            triggerValues: claim.triggerValues,
            target: claim.target,
          },
          enqueueWorkflowRun,
        );
        result[materialized.state] += 1;
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
  process: ({ ctx }) =>
    triggerEventTasks.run(async () => {
      try {
        await processMailWorkflowTriggerEvent(ctx.input.eventId, ctx.jobId, () => ctx.heartbeat());
      } catch (error) {
        if (ctx.failureCount >= TRIGGER_EVENT_MAX_RETRIES) await failTriggerEvent(ctx.input.eventId, error);
        throw error;
      }
    }) ?? Promise.resolve(),
  after: ({ ctx }) => {
    if (ctx.error && ctx.failureCount < TRIGGER_EVENT_MAX_RETRIES) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 2_000, maxMs: 60_000 }) });
    }
  },
});

export const enqueueMailWorkflowTriggerEvent = async (eventId: string): Promise<void> => {
  await (triggerEventTasks.run(() =>
    triggerEventJob.submit({ key: `event:${eventId}`, input: { eventId }, leaseMs: TRIGGER_EVENT_LEASE_MS }),
  ) ?? Promise.resolve());
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

export const startMailWorkflowTriggerRuntime = (): void => {
  triggerEventTasks.open();
};

export const stopMailWorkflowTriggerRuntime = async (): Promise<void> => {
  await stopRuntimeJobs(triggerEventTasks, [triggerEventJob]);
};
