/**
 * The loop that turns queued runs into finished ones.
 *
 * Grids and Mail each wrote this: claim a run, load its plan, drive the
 * executor, record the outcome, renew the lease while it works. The bodies
 * differed enough that a fix in one never reached the other — Grids leased the
 * run, Mail leased a target, and only one of them woke parked runs on a
 * deadline.
 *
 * An app now brings its action handlers and nothing else. Everything about
 * *when* something runs, *which* plan it runs, and what happens if the process
 * dies belongs here.
 */
import { type SQL, sql } from "bun";
import type { WorkflowActor, WorkflowJsonValue } from "../contracts";
import { coordinateWorkflowExecution } from "../runtime/coordinator";
import { executeWorkflowPlan } from "../runtime/executor";
import type { WorkflowExecuteActionPort, WorkflowTracePort, WorkflowValueResolverPort } from "../runtime/ports";
import { dispatchPendingWorkflowEvents } from "./events";
import {
  claimWorkflowRun,
  createWorkflowCoordinatorPort,
  createWorkflowRuntimeRepository,
  WORKFLOW_RUN_LEASE_MS,
  type WorkflowRunClaim,
  type WorkflowRunResult,
  wakeExpiredWorkflowRuns,
} from "./runs";

/** Renew well inside the lease, so one slow query does not cost the claim. */
const HEARTBEAT_MS = Math.floor(WORKFLOW_RUN_LEASE_MS / 3);

export type WorkflowWorkerOptions = {
  /** Identifies this process in `lease_owner`. Only ever read by humans. */
  worker: string;
  /** The app's action implementations. The only thing an app has to supply. */
  actions: WorkflowExecuteActionPort;
  /** Restricts the worker to one app's runs. Omit to drain everything. */
  appId?: string;
  trace?: WorkflowTracePort;
  values?: WorkflowValueResolverPort;
  maxLoopItems?: number;
  db?: SQL;
};

export type WorkflowWorkerOutcome =
  | { state: "idle" }
  | { state: "finished"; runId: string; result: WorkflowRunResult }
  | { state: "released"; runId: string; error: unknown }
  | { state: "lost"; runId: string };

/**
 * The actor a run executes as.
 *
 * Reconstructed from the authorization snapshot the activation froze, so an
 * edit to a group membership cannot silently widen what an already-queued run
 * is allowed to do.
 */
const actorFromSnapshot = (snapshot: WorkflowJsonValue): WorkflowActor => {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && "kind" in snapshot) {
    return snapshot as unknown as WorkflowActor;
  }
  return { kind: "system" } as unknown as WorkflowActor;
};

/**
 * Maps what the executor reported onto how the run settles.
 *
 * `waiting` is not an outcome — the step parked itself and the run with it, so
 * this only tells the coordinator the run is where it belongs.
 */
const settle = (result: Awaited<ReturnType<typeof executeWorkflowPlan>>): WorkflowRunResult => {
  switch (result.state) {
    case "succeeded":
      return { state: "succeeded", result: result.output ?? null };
    case "waiting":
      return { state: "waiting" };
    case "failed":
      return { state: "failed", error: result.error as unknown as WorkflowJsonValue };
    case "needs_attention":
      return { state: "needs_attention", error: result.error as unknown as WorkflowJsonValue };
    case "canceled":
      return { state: "canceled", ...(result.message ? { message: result.message } : {}) };
  }
};

/**
 * Claims one run and carries it as far as it goes.
 *
 * Returns `idle` when there was nothing to claim, which is what a polling loop
 * uses to back off. A crash anywhere inside leaves the run claimable again once
 * its lease expires, and the journal makes the resumed attempt skip whatever
 * already completed.
 */
export const runOneWorkflow = async (options: WorkflowWorkerOptions & { runId?: string }): Promise<WorkflowWorkerOutcome> => {
  const db = options.db ?? sql;
  const repository = createWorkflowRuntimeRepository({ db });
  // Execute only. A dry run is a question and belongs to the dry-run path; the
  // claim filter is what keeps this loop from answering it by doing the work.
  const port = createWorkflowCoordinatorPort({ worker: options.worker, runId: options.runId, appId: options.appId, mode: "execute" });

  const outcome = await coordinateWorkflowExecution<void, WorkflowRunClaim, WorkflowRunResult>({
    input: undefined,
    heartbeatMs: HEARTBEAT_MS,
    port,
    execute: async ({ claim, heartbeat }) => {
      const result = await executeWorkflowPlan({
        runId: claim.runId,
        executionGeneration: claim.executionGeneration,
        plan: claim.plan,
        invocation: {
          workflowId: claim.workflowId,
          mode: "execute",
          channel: "event",
          actor: actorFromSnapshot(claim.authorization),
          inputs: claim.inputs,
          idempotencyKey: claim.idempotencyKey,
          // Everything the plan reads under context.*, carried from the event.
          context: claim.context,
          // The occurrence's time, not the worker's: a replay after a crash has
          // to see the same "now" the first attempt did, or a step that reads
          // the date stops being a function of its inputs.
          occurredAt: claim.occurredAt.toISOString(),
        },
        repository,
        clock: { now: () => claim.occurredAt.toISOString() },
        actions: options.actions,
        ...(options.trace ? { trace: options.trace } : {}),
        ...(options.values ? { values: options.values } : {}),
        ...(options.maxLoopItems === undefined ? {} : { maxLoopItems: options.maxLoopItems }),
      });
      // Keep the lease honest for a plan whose last step ran long.
      await heartbeat();
      return settle(result);
    },
  });

  switch (outcome.state) {
    case "idle":
      return { state: "idle" };
    case "finished":
      return { state: "finished", runId: outcome.claim.runId, result: outcome.result };
    case "released":
    case "retry":
      return { state: "released", runId: outcome.claim.runId, error: outcome.error };
    case "stale":
    case "canceled":
      return { state: "lost", runId: outcome.claim.runId };
  }
};

export type WorkflowTickResult = {
  /** Events turned into runs this tick. */
  dispatched: number;
  /** Parked runs whose deadline passed. */
  woken: number;
  /** Runs carried to an outcome. */
  executed: number;
  failed: number;
};

/**
 * One pass of everything the kernel owes a workflow: dispatch what happened,
 * wake what was waiting, then run what is ready.
 *
 * In that order deliberately. Dispatching first means an event that arrived a
 * moment ago is executed in the same tick rather than the next one, which is
 * the difference between a workflow that feels immediate and one that always
 * lags a poll interval behind.
 */
export const tickWorkflows = async (options: WorkflowWorkerOptions & { maxRuns?: number }): Promise<WorkflowTickResult> => {
  const db = options.db ?? sql;
  const dispatch = await dispatchPendingWorkflowEvents(100, { appId: options.appId, db });
  const woken = await wakeExpiredWorkflowRuns(100, { appId: options.appId, db });

  let executed = 0;
  let failed = 0;
  const maxRuns = options.maxRuns ?? 25;
  for (let index = 0; index < maxRuns; index += 1) {
    const outcome = await runOneWorkflow(options);
    if (outcome.state === "idle") break;
    executed += 1;
    if (outcome.state === "released") failed += 1;
  }

  return { dispatched: dispatch.dispatched, woken: woken.length, executed, failed };
};

/** Whether there is anything for a worker to do, without claiming it. */
export const hasClaimableWorkflowRun = async (options: { appId?: string; db?: SQL } = {}): Promise<boolean> => {
  const db = options.db ?? sql;
  const [row] = await db<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM workflows.run
      WHERE state IN ('queued', 'running') AND claimable_at < now() AND cancel_requested_at IS NULL
        AND (${options.appId ?? null}::text IS NULL OR app_id = ${options.appId ?? null})
    ) AS exists
  `;
  return Boolean(row?.exists);
};

export { claimWorkflowRun };
