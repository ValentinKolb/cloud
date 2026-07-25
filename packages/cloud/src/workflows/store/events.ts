/**
 * Every run starts from an event.
 *
 * There used to be three ways in, with three durability stories: a direct
 * invocation, a schedule tick, and a trigger delivery. Grids recorded only a
 * `channel` enum, so once a run existed nobody could say what caused it. Here
 * the cause is a row, so "why did this run" is a join rather than a guess, and
 * idempotency, retry and recovery are written once instead of three times.
 *
 * A schedule tick is an event. A button press is an event. An inbound message
 * is an event. Nothing needs its own registration path.
 */
import { type SQL, sql } from "bun";
import type { WorkflowJsonValue } from "../contracts";
import { createWorkflowRun } from "./runs";

export type WorkflowEventInput = {
  appId: string;
  scopeId: string;
  /** Namespaced `${appId}.${key}`, matching a declaration in the app's `workflows.ts`. */
  type: string;
  data?: Record<string, WorkflowJsonValue>;
  /**
   * Makes a repeatable source at-most-once: a schedule slot, a provider
   * redelivery, a double-clicked button. Emitting the same key twice records
   * one event and therefore starts one run.
   */
  dedupeKey?: string;
  /** The occurrence's own time, not the emitter's. Runs replay against this. */
  occurredAt?: Date;
  /**
   * Everything the plan reads under context.*, distinct from the payload.
   *
   * An app that already holds the facts a run needs — a captured row, the
   * launcher that was pressed — hands them over rather than making every step
   * read them again.
   */
  context?: Record<string, WorkflowJsonValue>;
  /**
   * Who the resulting runs act as.
   *
   * Without this every run would execute as the system: the activation's own
   * snapshot is the fallback, and it is only meaningful for occurrences that
   * have no human behind them, like a schedule tick.
   */
  authorization?: WorkflowJsonValue;
  /**
   * Restricts matching to one workflow's activations.
   *
   * For occurrences that concern exactly one workflow because the app already
   * decided — it evaluated its own trigger filter — and a broadcast would start
   * every workflow in the scope.
   */
  targetWorkflowId?: string;
};

export type WorkflowEmission = {
  eventId: string;
  /** Empty when nothing was listening, or when dispatch was deferred. */
  runIds: string[];
  /** True when this exact event had already been recorded. */
  duplicate: boolean;
};

type ActivationMatch = {
  activation_id: string;
  workflow_id: string;
  workflow_version_id: string;
  authorization_snapshot: WorkflowJsonValue;
};

type StoredEvent = {
  id: string;
  appId: string;
  scopeId: string;
  type: string;
  occurredAt: Date;
  data: Record<string, WorkflowJsonValue>;
  context: Record<string, WorkflowJsonValue>;
  authorization: WorkflowJsonValue;
  targetWorkflowId: string | null;
};

/** An empty object means the emitter named nobody; fall back to the activation. */
const isEmpty = (value: WorkflowJsonValue): boolean =>
  !value || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);

/**
 * Turns one event into runs.
 *
 * Runs are keyed by the event and the activation that matched it, so a
 * redelivered event or a retried dispatch converges on the same runs rather
 * than adding more.
 */
const materializeRuns = async (tx: SQL, event: StoredEvent): Promise<string[]> => {
  const matches = await tx<ActivationMatch[]>`
    SELECT a.id AS activation_id, a.workflow_id, a.workflow_version_id, a.authorization_snapshot
    FROM workflows.activation AS a
    JOIN workflows.workflow AS w ON w.id = a.workflow_id
    WHERE a.enabled
      AND a.event_type = ${event.type}
      AND w.app_id = ${event.appId}
      AND w.scope_id = ${event.scopeId}
      AND (${event.targetWorkflowId}::uuid IS NULL OR a.workflow_id = ${event.targetWorkflowId}::uuid)
    ORDER BY a.id
  `;

  const runIds: string[] = [];
  for (const match of matches) {
    runIds.push(
      await createWorkflowRun(
        {
          appId: event.appId,
          scopeId: event.scopeId,
          workflowId: match.workflow_id,
          workflowVersionId: match.workflow_version_id,
          mode: "execute",
          inputs: event.data,
          context: event.context,
          // The emitter's actor wins; the activation's snapshot is what a
          // schedule tick or a captured row falls back to.
          authorization: isEmpty(event.authorization) ? match.authorization_snapshot : event.authorization,
          idempotencyKey: `event:${event.id}:${match.activation_id}`,
          occurredAt: event.occurredAt,
          eventId: event.id,
        },
        { db: tx },
      ),
    );
  }
  return runIds;
};

/**
 * Records an event and, unless deferred, starts the runs listening for it.
 *
 * `dispatch: "now"` is what a direct invocation uses: the caller gets run ids
 * back without a round trip through a queue, which is what the launcher and
 * "run this workflow" buttons depend on. Everything an app merely *observes* —
 * a row changing, a message arriving — defers, because losing the caller's
 * request is better than losing the occurrence: a failing dispatch would
 * otherwise roll back the event itself and the occurrence would vanish.
 */
export const emitWorkflowEvent = async (
  event: WorkflowEventInput,
  options: { dispatch?: "now" | "deferred"; db?: SQL } = {},
): Promise<WorkflowEmission> => {
  const db = options.db ?? sql;
  const occurredAt = event.occurredAt ?? new Date();
  const data = event.data ?? {};
  const context = event.context ?? {};
  const authorization = event.authorization ?? {};

  return db.begin(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO workflows.event (
        app_id, scope_id, type, data, context, authorization_snapshot, target_workflow_id, dedupe_key, occurred_at
      )
      VALUES (
        ${event.appId}, ${event.scopeId}, ${event.type}, ${data}, ${context}, ${authorization},
        ${event.targetWorkflowId ?? null}::uuid, ${event.dedupeKey ?? null}, ${occurredAt}
      )
      ON CONFLICT (app_id, scope_id, type, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING id
    `;

    if (!inserted[0]) {
      // Already recorded. Answer with the runs it produced the first time
      // rather than starting more — that is the whole point of the key.
      const [existing] = await tx<{ id: string }[]>`
        SELECT id FROM workflows.event
        WHERE app_id = ${event.appId}
          AND scope_id = ${event.scopeId}
          AND type = ${event.type}
          AND dedupe_key = ${event.dedupeKey ?? null}
      `;
      if (!existing) throw new Error("workflow event conflicted but could not be found");
      const runs = await tx<{ id: string }[]>`SELECT id FROM workflows.run WHERE event_id = ${existing.id}::uuid ORDER BY created_at, id`;
      return { eventId: existing.id, runIds: runs.map((row) => row.id), duplicate: true };
    }

    const eventId = inserted[0].id;
    if (options.dispatch !== "now") return { eventId, runIds: [], duplicate: false };

    const runIds = await materializeRuns(tx, {
      id: eventId,
      appId: event.appId,
      scopeId: event.scopeId,
      type: event.type,
      occurredAt,
      data,
      context,
      authorization,
      targetWorkflowId: event.targetWorkflowId ?? null,
    });
    await tx`UPDATE workflows.event SET dispatched_at = now(), attempts = attempts + 1 WHERE id = ${eventId}::uuid`;
    return { eventId, runIds, duplicate: false };
  });
};

/**
 * Starts the runs for events that were recorded but not yet dispatched.
 *
 * One event at a time, each in its own transaction: an event whose activations
 * cannot be materialised must not take the rest of the batch down with it. Its
 * failure is recorded on the row instead, because an event that matched nothing
 * and said nothing is exactly how Grids' schedules stopped firing.
 */
export const dispatchPendingWorkflowEvents = async (
  limit = 100,
  options: { appId?: string; db?: SQL } = {},
): Promise<{ dispatched: number; failed: number }> => {
  const db = options.db ?? sql;
  const pending = await db<{ id: string }[]>`
    SELECT id FROM workflows.event
    WHERE dispatched_at IS NULL AND (${options.appId ?? null}::text IS NULL OR app_id = ${options.appId ?? null})
    ORDER BY occurred_at, id
    LIMIT ${limit}
  `;

  let dispatched = 0;
  let failed = 0;
  for (const { id } of pending) {
    try {
      await db.begin(async (tx) => {
        const [row] = await tx<
          {
            id: string;
            app_id: string;
            scope_id: string;
            type: string;
            data: Record<string, WorkflowJsonValue>;
            context: Record<string, WorkflowJsonValue>;
            authorization_snapshot: WorkflowJsonValue;
            target_workflow_id: string | null;
            occurred_at: Date;
          }[]
        >`
          SELECT id, app_id, scope_id, type, data, context, authorization_snapshot, target_workflow_id, occurred_at
          FROM workflows.event
          WHERE id = ${id}::uuid AND dispatched_at IS NULL
          FOR UPDATE SKIP LOCKED
        `;
        // Another worker took it, or it was dispatched between the scan and here.
        if (!row) return;

        await materializeRuns(tx, {
          id: row.id,
          appId: row.app_id,
          scopeId: row.scope_id,
          type: row.type,
          occurredAt: row.occurred_at,
          data: row.data,
          context: row.context,
          authorization: row.authorization_snapshot,
          targetWorkflowId: row.target_workflow_id,
        });
        await tx`UPDATE workflows.event SET dispatched_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ${row.id}::uuid`;
        dispatched += 1;
      });
    } catch (error) {
      failed += 1;
      await db`
        UPDATE workflows.event
        SET attempts = attempts + 1, last_error = ${error instanceof Error ? error.message : String(error)}
        WHERE id = ${id}::uuid
      `;
    }
  }
  return { dispatched, failed };
};

/** Events that never turned into runs. The first thing to look at when a workflow "just stopped". */
export const listUndispatchedWorkflowEvents = async (
  options: { limit?: number; appId?: string; db?: SQL } = {},
): Promise<{ id: string; appId: string; type: string; occurredAt: Date; attempts: number; lastError: string | null }[]> => {
  const db = options.db ?? sql;
  const rows = await db<{ id: string; app_id: string; type: string; occurred_at: Date; attempts: number; last_error: string | null }[]>`
    SELECT id, app_id, type, occurred_at, attempts, last_error FROM workflows.event
    WHERE dispatched_at IS NULL AND (${options.appId ?? null}::text IS NULL OR app_id = ${options.appId ?? null})
    ORDER BY occurred_at, id
    LIMIT ${options.limit ?? 100}
  `;
  return rows.map((row) => ({
    id: row.id,
    appId: row.app_id,
    type: row.type,
    occurredAt: row.occurred_at,
    attempts: row.attempts,
    lastError: row.last_error,
  }));
};
