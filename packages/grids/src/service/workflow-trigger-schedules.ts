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
const managedWorkflowId = (id: string): string | null => {
  if (!id.startsWith(SCHEDULE_ID_PREFIX)) return null;
  return id.slice(SCHEDULE_ID_PREFIX.length) || null;
};
const scheduleTriggerKey = (workflowId: string, trigger: "cron" | "manual", slotTs: number, runNumber: number): string =>
  `schedule:${workflowId}:${trigger}:${slotTs}:${runNumber}`;

type WorkflowScheduleRuntimeDeps = {
  log: Pick<ReturnType<typeof logger>, "info" | "warn">;
  workflowScheduler: ReturnType<typeof scheduler>;
  workflows: Pick<typeof workflowStore, "get">;
  loadWorkflowPrincipal: typeof workflowOwnerPrincipal;
  getBase: typeof bases.get;
  settingsGet: typeof settingsGet;
  normalizeTimeZone: typeof normalizeTimeZone;
  queuePreparedRun: (item: PreparedWorkflowTriggerRun, options?: { triggerKey?: string }) => Promise<WorkflowRun>;
  scheduleRepair: (workflowId: string) => void;
  maxRetries: number;
};

export type ManagedWorkflowSchedule = {
  workflowId: string;
  revision: number;
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
        workflowRevision: workflow.revision,
        resourceLabel: base ? `${base.name} / ${workflow.name}` : workflow.name,
        ...(base ? { detailHref: `/app/grids/${base.shortId}/workflows/${workflow.shortId}` } : {}),
      },
      trace: trace.fromSyncSchedule<{ runId: string | null; queued: boolean; status: string }>({
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
        const registered = await deps.workflowScheduler.get({ id: scheduleId(workflow.id) });
        const current = await deps.workflows.get(workflow.id);
        const currentSchedule = current?.compiled.triggers.schedule;
        const currentTimezone = current && currentSchedule ? await getScheduleTimezone(current) : null;
        const stale =
          !registered ||
          !current?.enabled ||
          !currentSchedule ||
          registered.cron !== currentSchedule.cron ||
          registered.tz !== currentTimezone ||
          (ctx.trigger === "cron" && registered.nextRunAt !== ctx.slotTs);
        if (stale) {
          return { runId: null, queued: false, status: "skipped" };
        }
        const triggerInput = { slotTs: ctx.slotTs, trigger: ctx.trigger, runNumber: ctx.runNumber };
        const principal = await deps.loadWorkflowPrincipal(current);
        const item: PreparedWorkflowTriggerRun = {
          workflow: current,
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
        if (ctx.data?.status === "skipped") {
          deps.scheduleRepair(workflow.id);
          return;
        }
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

  const listManagedWorkflows = async (): Promise<ManagedWorkflowSchedule[]> => {
    const registered = await deps.workflowScheduler.list();
    return registered.flatMap((item) => {
      const workflowId = managedWorkflowId(item.id);
      if (!workflowId) return [];
      const revision = Number(item.meta?.workflowRevision);
      return [{ workflowId, revision: Number.isSafeInteger(revision) && revision > 0 ? revision : 0 }];
    });
  };

  const getManagedWorkflowRevision = async (workflowId: string): Promise<number> => {
    const item = await deps.workflowScheduler.get({ id: scheduleId(workflowId) });
    const revision = Number(item?.meta?.workflowRevision);
    return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
  };

  return {
    create,
    getManagedWorkflowRevision,
    listManagedWorkflows,
    delete: (workflowId: string) => deps.workflowScheduler.delete({ id: scheduleId(workflowId) }),
    runNow: (workflowId: string) => deps.workflowScheduler.runNow({ id: scheduleId(workflowId) }),
  };
};
