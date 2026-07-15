import { trace } from "@valentinkolb/cloud/services";
import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import {
  createWorkflowScheduleRegistration,
  reconcileWorkflowSchedules,
  type WorkflowScheduleRegistration,
  workflowScheduleSlotKey,
} from "@valentinkolb/cloud/workflows/runtime";
import { type Scheduler, scheduler } from "@valentinkolb/sync";
import { sql } from "bun";
import type { AutomaticWorkflowMaterialization } from "./workflow-materialization-service";

const MAIL_WORKFLOW_SCHEDULER_ID = "mail:workflow-schedules";
const MAIL_WORKFLOW_SCHEDULE_PREFIX = "mail:workflow-schedule:";
const MAIL_WORKFLOW_SCHEDULE_MAX_RETRIES = 5;

type DbScheduleActivation = {
  activation_id: string;
  workflow_id: string;
  workflow_version_id: string;
  workflow_name: string;
  version_identity: string;
  trigger_key: string;
  trigger_config: Record<string, WorkflowJsonValue> | string;
};

export type MailWorkflowScheduleActivation = {
  activationId: string;
  workflowVersionId: string;
  workflowName: string;
  registration: WorkflowScheduleRegistration;
};

export type MailWorkflowScheduleResult =
  | AutomaticWorkflowMaterialization
  | { state: "stale"; reason: "activation" | "revision" | "schedule" };

type AutomaticMaterializer = typeof import("./workflow-materialization-service").materializeAutomaticWorkflowRun;
type ScheduleMaterialization = (input: Parameters<AutomaticMaterializer>[0]) => ReturnType<AutomaticMaterializer>;

export type MailWorkflowScheduleRuntimeDependencies = {
  transport: Scheduler;
  listActive(): Promise<MailWorkflowScheduleActivation[]>;
  loadCurrent(registration: WorkflowScheduleRegistration): Promise<MailWorkflowScheduleActivation | null>;
  materialize: ScheduleMaterialization;
};

const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);

export const mailWorkflowScheduleRegistration = (input: {
  workflowId: string;
  triggerKey: string;
  versionIdentity: string;
  cron: string;
  timezone: string;
}): WorkflowScheduleRegistration => {
  const registration = createWorkflowScheduleRegistration({
    namespace: "mail",
    workflowId: input.workflowId,
    triggerId: input.triggerKey,
    revision: input.versionIdentity,
    cron: input.cron,
    timezone: input.timezone,
  });
  return { ...registration, id: `${MAIL_WORKFLOW_SCHEDULE_PREFIX}${registration.id}` };
};

const mapScheduleActivation = (row: DbScheduleActivation): MailWorkflowScheduleActivation => {
  const config = parseJson(row.trigger_config);
  if (typeof config.cron !== "string") throw new Error(`Mail workflow schedule ${row.activation_id} has no cron expression`);
  return {
    activationId: row.activation_id,
    workflowVersionId: row.workflow_version_id,
    workflowName: row.workflow_name,
    registration: mailWorkflowScheduleRegistration({
      workflowId: row.workflow_id,
      triggerKey: row.trigger_key,
      versionIdentity: row.version_identity,
      cron: config.cron,
      timezone: typeof config.timezone === "string" ? config.timezone : "UTC",
    }),
  };
};

const scheduleActivationColumns = sql`
  activation.id AS activation_id,
  activation.workflow_id,
  activation.workflow_version_id,
  workflow.name AS workflow_name,
  version.version_identity,
  activation.trigger_key,
  activation.trigger_config
`;

const listActiveScheduleActivations = async (): Promise<MailWorkflowScheduleActivation[]> => {
  const rows = await sql<DbScheduleActivation[]>`
    SELECT ${scheduleActivationColumns}
    FROM mail.workflow_activations activation
    JOIN mail.workflows workflow
      ON workflow.id = activation.workflow_id
     AND workflow.mailbox_id = activation.mailbox_id
     AND workflow.active_version_id = activation.workflow_version_id
    JOIN mail.workflow_versions version
      ON version.id = activation.workflow_version_id
     AND version.workflow_id = activation.workflow_id
     AND version.mailbox_id = activation.mailbox_id
    WHERE activation.trigger_kind = 'schedule'
      AND activation.enabled
    ORDER BY activation.workflow_id, activation.trigger_key, activation.id
  `;
  return rows.map(mapScheduleActivation);
};

const loadCurrentScheduleActivation = async (
  registration: WorkflowScheduleRegistration,
): Promise<MailWorkflowScheduleActivation | null> => {
  const [row] = await sql<DbScheduleActivation[]>`
    SELECT ${scheduleActivationColumns}
    FROM mail.workflow_activations activation
    JOIN mail.workflows workflow
      ON workflow.id = activation.workflow_id
     AND workflow.mailbox_id = activation.mailbox_id
     AND workflow.active_version_id = activation.workflow_version_id
    JOIN mail.workflow_versions version
      ON version.id = activation.workflow_version_id
     AND version.workflow_id = activation.workflow_id
     AND version.mailbox_id = activation.mailbox_id
    WHERE activation.workflow_id = ${registration.workflowId}::uuid
      AND activation.trigger_key = ${registration.triggerId}
      AND activation.trigger_kind = 'schedule'
      AND activation.enabled
  `;
  return row ? mapScheduleActivation(row) : null;
};

const currentRegistration = (
  item: Awaited<ReturnType<Scheduler["list"]>>[number],
  desiredById: ReadonlyMap<string, WorkflowScheduleRegistration>,
): WorkflowScheduleRegistration => {
  const desired = desiredById.get(item.id);
  return {
    id: item.id,
    namespace: desired?.namespace ?? "mail",
    workflowId: desired?.workflowId ?? item.id,
    triggerId: desired?.triggerId ?? "stale",
    revision: desired?.revision ?? "stale",
    schedule: { cron: item.cron, timezone: item.tz },
  };
};

const sameSchedule = (left: WorkflowScheduleRegistration, right: WorkflowScheduleRegistration): boolean =>
  left.schedule.cron === right.schedule.cron && left.schedule.timezone === right.schedule.timezone;

export const createMailWorkflowScheduleRuntime = (dependencies: MailWorkflowScheduleRuntimeDependencies) => {
  let started = false;

  const processSlot = async (registration: WorkflowScheduleRegistration, slotTs: number): Promise<MailWorkflowScheduleResult> => {
    const current = await dependencies.loadCurrent(registration);
    if (!current) return { state: "stale", reason: "activation" };
    if (current.registration.id !== registration.id || current.registration.revision !== registration.revision) {
      return { state: "stale", reason: "revision" };
    }
    if (!sameSchedule(current.registration, registration)) return { state: "stale", reason: "schedule" };

    const slot = new Date(slotTs).toISOString();
    const slotKey = workflowScheduleSlotKey(registration.id, slot);
    return await dependencies.materialize({
      activationId: current.activationId,
      triggerKind: "schedule",
      deliveryKey: slotKey,
      occurredAt: slot,
      channel: "schedule",
      triggerValues: { occurredAt: slot, slot },
      target: {
        key: slotKey,
        source: {},
        preconditions: {},
      },
    });
  };

  const register = async (registration: WorkflowScheduleRegistration, activation: MailWorkflowScheduleActivation): Promise<void> => {
    await dependencies.transport.create<MailWorkflowScheduleResult>({
      id: registration.id,
      cron: registration.schedule.cron,
      tz: registration.schedule.timezone,
      meta: {
        appId: "mail",
        family: MAIL_WORKFLOW_SCHEDULER_ID,
        label: `Workflow: ${activation.workflowName}`,
        source: MAIL_WORKFLOW_SCHEDULER_ID,
        resourceLabel: activation.workflowName,
        workflowId: registration.workflowId,
        workflowVersionId: activation.workflowVersionId,
        revision: registration.revision,
        triggerId: registration.triggerId,
      },
      trace: trace.fromSyncSchedule<MailWorkflowScheduleResult>({
        name: `Mail workflow schedule: ${activation.workflowName}`,
        source: registration.id,
        appId: "mail",
        attributes: {
          "cloud.mail.workflow_id": registration.workflowId,
          "cloud.mail.workflow_version_id": activation.workflowVersionId,
        },
      }),
      process: async ({ ctx }) => await processSlot(registration, ctx.slotTs),
      after: ({ ctx }) => {
        if (ctx.error && ctx.failureCount < MAIL_WORKFLOW_SCHEDULE_MAX_RETRIES) {
          ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 60_000 }) });
        }
      },
    });
  };

  const reconcile = async (): Promise<void> => {
    const activations = await dependencies.listActive();
    const desired = activations.map((activation) => activation.registration);
    const activationById = new Map(activations.map((activation) => [activation.registration.id, activation]));
    const desiredById = new Map(desired.map((registration) => [registration.id, registration]));
    const current = (await dependencies.transport.list())
      .filter((item) => item.id.startsWith(MAIL_WORKFLOW_SCHEDULE_PREFIX))
      .map((item) => currentRegistration(item, desiredById));

    await reconcileWorkflowSchedules({
      desired,
      current,
      port: {
        create: async (registration) => await register(registration, activationById.get(registration.id)!),
        update: async (_current, registration) => await register(registration, activationById.get(registration.id)!),
        remove: async (registration) => await dependencies.transport.delete({ id: registration.id }),
      },
    });
  };

  return {
    reconcile,
    start: async (): Promise<void> => {
      if (started) return;
      await reconcile();
      dependencies.transport.start();
      started = true;
    },
    stop: async (): Promise<void> => {
      if (!started) return;
      await dependencies.transport.stop();
      started = false;
    },
  };
};

const mailWorkflowScheduleRuntime = createMailWorkflowScheduleRuntime({
  transport: scheduler({ id: MAIL_WORKFLOW_SCHEDULER_ID }),
  listActive: listActiveScheduleActivations,
  loadCurrent: loadCurrentScheduleActivation,
  materialize: async (input) => {
    const { materializeAutomaticWorkflowRun } = await import("./workflow-materialization-service");
    return materializeAutomaticWorkflowRun(input);
  },
});

export const reconcileMailWorkflowSchedules = async (): Promise<void> => await mailWorkflowScheduleRuntime.reconcile();
export const startMailWorkflowScheduleRuntime = async (): Promise<void> => await mailWorkflowScheduleRuntime.start();
export const stopMailWorkflowScheduleRuntime = async (): Promise<void> => await mailWorkflowScheduleRuntime.stop();
