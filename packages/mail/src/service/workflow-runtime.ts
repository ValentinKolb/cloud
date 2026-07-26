import { createRuntimeLifecycle, createRuntimeTaskTracker, logger } from "@valentinkolb/cloud/services";
import { createWorkflowBuiltinActionPorts, type WorkflowExecutionError } from "@valentinkolb/cloud/workflows";
import type { WorkflowExecuteActionPort } from "@valentinkolb/cloud/workflows/runtime";
import {
  createWorkflowActionPort,
  runOneWorkflow,
  tickWorkflows,
  type WorkflowRunClaim,
  wakeExpiredWorkflowRuns,
} from "@valentinkolb/cloud/workflows/store";
import { sql } from "bun";
import { MAIL_WORKFLOW_ACTIONS } from "../workflows/actions";
import { MAIL_WORKFLOW_APP_ID } from "../workflows/events";
import { createMailWorkflowValueResolver } from "./workflow-runtime-values";
import { startMailWorkflowScheduleRuntime, stopMailWorkflowScheduleRuntime } from "./workflow-schedule-runtime";

const log = logger("mail:workflows");
const WORKER_INTERVAL_MS = 1_000;
const RECONCILE_INTERVAL_MS = 60_000;
const workerId = `mail:${Bun.env.HOSTNAME ?? "local"}:${process.pid}`;

const declaredActions = createWorkflowActionPort(MAIL_WORKFLOW_ACTIONS);
const builtins = createWorkflowBuiltinActionPorts({
  authorize: async (context): Promise<WorkflowExecutionError | undefined> => {
    const [active] = await sql<{ active: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM workflows.run run
        JOIN workflows.workflow workflow
          ON workflow.id = run.workflow_id
         AND workflow.active_version_id = run.workflow_version_id
        JOIN mail.workflow_profile profile
          ON profile.id = workflow.id
         AND profile.enabled
        WHERE run.id = ${context.run.runId}::uuid
      ) AS active
    `;
    return active?.active ? undefined : { code: "FORBIDDEN", message: "Workflow is no longer active.", retryable: false };
  },
});
const actions: WorkflowExecuteActionPort = {
  get: (name) => declaredActions.get(name) ?? builtins.execute.get(name),
};

const values = (claim: WorkflowRunClaim) => {
  let frozen: Promise<Record<string, import("@valentinkolb/cloud/workflows").WorkflowJsonValue>> | null = null;
  return {
    resolve: async (input: Parameters<ReturnType<typeof createMailWorkflowValueResolver>["resolve"]>[0]) => {
      frozen ??= sql<{ frozen_hydration: Record<string, import("@valentinkolb/cloud/workflows").WorkflowJsonValue> | string }[]>`
        SELECT frozen_hydration
        FROM mail.workflow_run_state
        WHERE run_id = ${claim.runId}::uuid
      `.then((rows) => {
        const value = rows[0]?.frozen_hydration;
        return typeof value === "string" ? JSON.parse(value) : (value ?? {});
      });
      return createMailWorkflowValueResolver({
        claim,
        mailboxId: claim.scopeId,
        frozenHydration: await frozen,
      }).resolve(input);
    },
  };
};

const workerPorts = { worker: workerId, appId: MAIL_WORKFLOW_APP_ID, values } as const;

export const runMailWorkflow = (runId: string) => runOneWorkflow({ ...workerPorts, actions, runId });

const drain = async (): Promise<void> => {
  await tickWorkflows({ ...workerPorts, actions });
};

let workerTimer: ReturnType<typeof setInterval> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;
const tasks = createRuntimeTaskTracker();

const drainOnce = (): void => {
  if (draining) return;
  draining = true;
  const task = tasks.run(async () => {
    try {
      await drain();
    } catch (error) {
      log.error("Mail workflow worker tick failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      draining = false;
    }
  });
  if (task) void task.catch(() => undefined);
  else draining = false;
};

const lifecycle = createRuntimeLifecycle({
  start: async () => {
    tasks.open();
    await startMailWorkflowScheduleRuntime();
    await wakeExpiredWorkflowRuns(100, { appId: MAIL_WORKFLOW_APP_ID });
    drainOnce();
    workerTimer = setInterval(drainOnce, WORKER_INTERVAL_MS);
    reconcileTimer = setInterval(() => {
      const task = tasks.run(async () => {
        await wakeExpiredWorkflowRuns(100, { appId: MAIL_WORKFLOW_APP_ID });
      });
      if (task) void task.catch(() => undefined);
    }, RECONCILE_INTERVAL_MS);
  },
  stop: async () => {
    if (workerTimer) clearInterval(workerTimer);
    if (reconcileTimer) clearInterval(reconcileTimer);
    workerTimer = null;
    reconcileTimer = null;
    await stopMailWorkflowScheduleRuntime();
    await tasks.close();
  },
});

export const workflowRuntime = { start: lifecycle.start, stop: lifecycle.stop };
