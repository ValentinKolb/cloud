import { describe, expect, mock, test } from "bun:test";
import type { ScheduleAfterCtx, ScheduleConfig, ScheduleCtx, Scheduler, SchedulerInfo } from "@valentinkolb/sync";
import {
  createMailWorkflowScheduleRuntime,
  type MailWorkflowScheduleActivation,
  type MailWorkflowScheduleResult,
  type MailWorkflowScheduleRuntimeDependencies,
  mailWorkflowScheduleRegistration,
} from "./workflow-schedule-runtime";

const workflowId = "10000000-0000-4000-8000-000000000001";
type MaterializeInput = Parameters<MailWorkflowScheduleRuntimeDependencies["materialize"]>[0];

const activation = (overrides: Partial<MailWorkflowScheduleActivation> = {}): MailWorkflowScheduleActivation => ({
  activationId: "20000000-0000-4000-8000-000000000001",
  workflowVersionId: "30000000-0000-4000-8000-000000000001",
  workflowName: "Morning triage",
  registration: mailWorkflowScheduleRegistration({
    workflowId,
    triggerKey: "schedule",
    versionIdentity: "mail-version-1",
    cron: "0 8 * * *",
    timezone: "Europe/Berlin",
  }),
  ...overrides,
});

const schedulerInfo = (id: string, cron = "0 8 * * *", tz = "Europe/Berlin"): SchedulerInfo => ({
  id,
  cron,
  tz,
  createdAt: 0,
  updatedAt: 0,
  nextRunAt: 0,
  runNumber: 0,
  failureCount: 0,
});

const transportFixture = (current: SchedulerInfo[] = []) => {
  const schedules = new Map<string, ScheduleConfig<MailWorkflowScheduleResult>>();
  const create = mock(async <R>(config: ScheduleConfig<R>) => {
    schedules.set(config.id, config as unknown as ScheduleConfig<MailWorkflowScheduleResult>);
    return { created: true, updated: false };
  });
  const remove = mock(async (_input: { id: string }) => undefined);
  const start = mock(() => undefined);
  const stop = mock(async () => undefined);
  return {
    schedules,
    create,
    remove,
    start,
    stop,
    transport: {
      id: "mail:workflow-schedules",
      create,
      delete: remove,
      list: async () => current,
      start,
      stop,
    } as unknown as Scheduler,
  };
};

const scheduleContext = (slotTs: number): ScheduleCtx => ({
  scheduleId: "test",
  slotTs,
  runNumber: 1,
  failureCount: 0,
  trigger: "cron",
  duration: 0,
  signal: new AbortController().signal,
});

describe("Mail workflow schedule runtime", () => {
  test("registers normalized Mail-prefixed schedules fenced by version", async () => {
    const current = activation({
      registration: mailWorkflowScheduleRegistration({
        workflowId,
        triggerKey: "schedule",
        versionIdentity: "mail-version-1",
        cron: " 0  8 * * * ",
        timezone: "Europe/Berlin",
      }),
    });
    const transport = transportFixture();
    const runtime = createMailWorkflowScheduleRuntime({
      transport: transport.transport,
      listActive: async () => [current],
      loadCurrent: async () => current,
      materialize: mock(async () => ({ state: "created", runId: "run-1" }) as const),
    });

    await runtime.reconcile();

    const [registered] = [...transport.schedules.values()];
    expect(registered?.id.startsWith("mail:workflow-schedule:")).toBe(true);
    expect(registered?.cron).toBe("0 8 * * *");
    expect(registered?.tz).toBe("Europe/Berlin");
    expect(registered?.meta).toMatchObject({
      appId: "mail",
      workflowId,
      workflowVersionId: current.workflowVersionId,
      revision: "mail-version-1",
      triggerId: "schedule",
    });
    expect(
      mailWorkflowScheduleRegistration({
        workflowId,
        triggerKey: "schedule",
        versionIdentity: "mail-version-2",
        cron: "0 8 * * *",
        timezone: "Europe/Berlin",
      }).id,
    ).toBe(current.registration.id);
  });

  test("revalidates the activation and materializes a deterministic schedule slot", async () => {
    const desired = activation();
    const current = activation({ activationId: "20000000-0000-4000-8000-000000000002" });
    const materialize = mock(async (_input: MaterializeInput) => ({ state: "created", runId: "run-1" }) as const);
    const transport = transportFixture();
    const runtime = createMailWorkflowScheduleRuntime({
      transport: transport.transport,
      listActive: async () => [desired],
      loadCurrent: mock(async () => current),
      materialize,
    });
    await runtime.reconcile();
    const registered = transport.schedules.get(desired.registration.id)!;
    const slotTs = Date.parse("2026-07-15T08:00:00.000Z");

    await registered.process({ ctx: scheduleContext(slotTs) });
    await registered.process({ ctx: scheduleContext(slotTs) });

    expect(materialize).toHaveBeenCalledTimes(2);
    const first = materialize.mock.calls[0]![0];
    const second = materialize.mock.calls[1]![0];
    expect(first.activationId).toBe(current.activationId);
    expect(first.deliveryKey).toBe(second.deliveryKey);
    expect(first).toMatchObject({
      triggerKind: "schedule",
      occurredAt: "2026-07-15T08:00:00.000Z",
      channel: "schedule",
      triggerValues: {
        occurredAt: "2026-07-15T08:00:00.000Z",
        slot: "2026-07-15T08:00:00.000Z",
      },
      target: {
        key: first.deliveryKey,
        source: {},
        preconditions: {},
      },
    });
  });

  test("does not materialize a slot after activation, revision, or schedule drift", async () => {
    const desired = activation();
    const materialize = mock(async () => ({ state: "created", runId: "run-1" }) as const);
    const transport = transportFixture();
    let current: MailWorkflowScheduleActivation | null = null;
    const runtime = createMailWorkflowScheduleRuntime({
      transport: transport.transport,
      listActive: async () => [desired],
      loadCurrent: async () => current,
      materialize,
    });
    await runtime.reconcile();
    const registered = transport.schedules.get(desired.registration.id)!;
    const ctx = scheduleContext(Date.parse("2026-07-15T08:00:00.000Z"));

    expect(await registered.process({ ctx })).toEqual({ state: "stale", reason: "activation" });
    current = activation({
      registration: mailWorkflowScheduleRegistration({
        workflowId,
        triggerKey: "schedule",
        versionIdentity: "mail-version-2",
        cron: "0 8 * * *",
        timezone: "Europe/Berlin",
      }),
    });
    expect(await registered.process({ ctx })).toEqual({ state: "stale", reason: "revision" });
    current = activation({
      registration: mailWorkflowScheduleRegistration({
        workflowId,
        triggerKey: "schedule",
        versionIdentity: "mail-version-1",
        cron: "0 9 * * *",
        timezone: "Europe/Berlin",
      }),
    });
    expect(await registered.process({ ctx })).toEqual({ state: "stale", reason: "schedule" });
    expect(materialize).not.toHaveBeenCalled();
  });

  test("updates changed schedules, removes stale Mail schedules, and leaves other schedulers alone", async () => {
    const desired = activation();
    const staleId = `${desired.registration.id}:old`;
    const transport = transportFixture([
      schedulerInfo(desired.registration.id, "0 7 * * *"),
      schedulerInfo(staleId),
      schedulerInfo("grids:workflow-schedule:unrelated"),
    ]);
    const runtime = createMailWorkflowScheduleRuntime({
      transport: transport.transport,
      listActive: async () => [desired],
      loadCurrent: async () => desired,
      materialize: mock(async () => ({ state: "existing", runId: "run-1" }) as const),
    });

    await runtime.reconcile();

    expect(transport.create).toHaveBeenCalledTimes(1);
    expect(transport.remove).toHaveBeenCalledTimes(1);
    expect(transport.remove).toHaveBeenCalledWith({ id: staleId });
  });

  test("bounds retries and starts only after registration", async () => {
    const desired = activation();
    const transport = transportFixture();
    const runtime = createMailWorkflowScheduleRuntime({
      transport: transport.transport,
      listActive: async () => [desired],
      loadCurrent: async () => desired,
      materialize: mock(async () => ({ state: "existing", runId: "run-1" }) as const),
    });

    await runtime.start();
    await runtime.start();
    const registered = transport.schedules.get(desired.registration.id)!;
    const reschedule = mock(() => undefined);
    const afterContext = (failureCount: number) =>
      ({
        ...scheduleContext(Date.now()),
        failureCount,
        error: new Error("temporary"),
        reschedule,
        expBackoff: () => 5_000,
        metric: {
          isLeader: true,
          leaderChanges: 0,
          dispatches: 0,
          failures: 0,
          reschedules: 0,
          tickErrors: 0,
          lastTickAt: null,
        },
      }) satisfies ScheduleAfterCtx<MailWorkflowScheduleResult>;

    await registered.after?.({ ctx: afterContext(4) });
    await registered.after?.({ ctx: afterContext(5) });
    await runtime.stop();
    await runtime.stop();

    expect(transport.create).toHaveBeenCalledTimes(1);
    expect(transport.start).toHaveBeenCalledTimes(1);
    expect(reschedule).toHaveBeenCalledTimes(1);
    expect(reschedule).toHaveBeenCalledWith({ delayMs: 5_000 });
    expect(transport.stop).toHaveBeenCalledTimes(1);
  });
});
