import { type logger, trace } from "@valentinkolb/cloud/services";
import type { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import type { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import type { scheduler } from "@valentinkolb/sync";
import type { Workflow, WorkflowRun } from "../contracts";
import type * as bases from "./bases";
import type { PreparedWorkflowTriggerRun, workflowOwnerPrincipal } from "./workflow-runtime";
import type * as workflowStore from "./workflows";

const SCHEDULE_ID_PREFIX = "grids:workflow:";

const scheduleId = (workflowId: string): string => `${SCHEDULE_ID_PREFIX}${workflowId}`;
const scheduleSource = (workflowId: string): string => `${SCHEDULE_ID_PREFIX}${workflowId}:schedule`;
const isManagedScheduleId = (id: string): boolean => id.startsWith(SCHEDULE_ID_PREFIX);
const scheduleTriggerKey = (workflowId: string, trigger: "cron" | "manual", slotTs: number, runNumber: number): string =>
  `schedule:${workflowId}:${trigger}:${slotTs}:${runNumber}`;

type WorkflowScheduleRuntimeDeps = {
  log: Pick<ReturnType<typeof logger>, "info" | "warn">;
  workflowScheduler: ReturnType<typeof scheduler>;
  workflows: Pick<typeof workflowStore, "listScheduledEnabled">;
  loadWorkflowPrincipal: typeof workflowOwnerPrincipal;
  getBase: typeof bases.get;
  settingsGet: typeof settingsGet;
  normalizeTimeZone: typeof normalizeTimeZone;
  queuePreparedRun: (item: PreparedWorkflowTriggerRun, options?: { triggerKey?: string }) => Promise<WorkflowRun>;
  maxRetries: number;
};

export const createWorkflowScheduleRuntime = (deps: WorkflowScheduleRuntimeDeps) => {
  const getScheduleTimezone = async (workflow: Workflow): Promise<string> => {
    const schedule = workflow.compiled.triggers.schedule;
    if (schedule?.timezone) return schedule.timezone;
    const configured = String((await deps.settingsGet<string>("app.timezone")) || "").trim();
    return deps.normalizeTimeZone(configured, "Europe/Berlin");
  };

  const create = async (workflow: Workflow): Promise<void> => {
    const schedule = workflow.compiled.triggers.schedule;
    if (!workflow.enabled || !schedule) {
      await deps.workflowScheduler.delete({ id: scheduleId(workflow.id) });
      return;
    }
    const tz = await getScheduleTimezone(workflow);
    const base = await deps.getBase(workflow.baseId);
    const source = scheduleSource(workflow.id);
    await deps.workflowScheduler.create({
      id: scheduleId(workflow.id),
      cron: schedule.cron,
      tz,
      meta: {
        appId: "grids",
        family: "grids:workflows",
        label: workflow.name,
        source,
        resourceKind: "workflow",
        resourceId: workflow.id,
        resourceLabel: base ? `${base.name} / ${workflow.name}` : workflow.name,
        ...(base ? { detailHref: `/app/grids/${base.shortId}/workflows/${workflow.shortId}` } : {}),
      },
      trace: trace.fromSyncSchedule<{ runId: string; queued: boolean; status: string }>({
        name: "Grid workflow schedule",
        source,
        appId: "grids",
        attributes: {
          "cloud.grids.workflow_id": workflow.id,
          "cloud.grids.base_id": workflow.baseId,
        },
        summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
      }),
      process: async ({ ctx }) => {
        const triggerInput = { slotTs: ctx.slotTs, trigger: ctx.trigger, runNumber: ctx.runNumber };
        const principal = await deps.loadWorkflowPrincipal(workflow);
        const item: PreparedWorkflowTriggerRun = {
          workflow,
          triggerKind: "schedule",
          actorUserId: principal.actorUserId,
          actorGroupIds: principal.actorGroupIds,
          serviceAccountId: principal.serviceAccountId,
          triggerInput,
          resolvedInput: {},
          authorization: { kind: "workflow" },
        };
        const run = await deps.queuePreparedRun(item, {
          triggerKey: scheduleTriggerKey(workflow.id, ctx.trigger, ctx.slotTs, ctx.runNumber),
        });
        return { runId: run.id, queued: run.status === "queued", status: run.status };
      },
      after: async ({ ctx }) => {
        if (ctx.error && ctx.failureCount < deps.maxRetries) {
          ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 30_000, maxMs: 5 * 60_000 }) });
        }
      },
    });
    deps.log.info("Workflow schedule registered", {
      workflowId: workflow.id,
      cron: schedule.cron,
      timezone: tz,
    });
  };

  const registerAll = async (): Promise<void> => {
    const scheduled = await deps.workflows.listScheduledEnabled();
    const activeIds = new Set(scheduled.map((workflow) => scheduleId(workflow.id)));
    for (const workflow of scheduled) {
      try {
        await create(workflow);
      } catch (error) {
        deps.log.warn("Workflow schedule registration failed", {
          workflowId: workflow.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const registered = await deps.workflowScheduler.list();
    for (const item of registered) {
      if (isManagedScheduleId(item.id) && !activeIds.has(item.id)) {
        await deps.workflowScheduler.delete({ id: item.id });
        deps.log.info("Orphan workflow schedule removed", { scheduleId: item.id });
      }
    }
  };

  return {
    create,
    registerAll,
    delete: (workflowId: string) => deps.workflowScheduler.delete({ id: scheduleId(workflowId) }),
    runNow: (workflowId: string) => deps.workflowScheduler.runNow({ id: scheduleId(workflowId) }),
  };
};
