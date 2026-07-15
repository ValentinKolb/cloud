import { describe, expect, mock, test } from "bun:test";
import {
  createWorkflowScheduleRegistration,
  normalizeWorkflowSchedule,
  planWorkflowScheduleReconciliation,
  reconcileWorkflowSchedules,
  workflowScheduleSlotKey,
} from "./schedule";

const registration = (workflowId: string, revision: string, cron = "0 8 * * *") =>
  createWorkflowScheduleRegistration({
    namespace: "grids",
    workflowId,
    triggerId: "morning",
    revision,
    cron,
    timezone: "Europe/Berlin",
  });

describe("workflow schedules", () => {
  test("normalizes strict five-field cron and IANA timezone", () => {
    expect(normalizeWorkflowSchedule({ cron: "  0\t8  * *   * ", timezone: " Europe/Berlin " })).toEqual({
      cron: "0 8 * * *",
      timezone: "Europe/Berlin",
    });
    expect(normalizeWorkflowSchedule({ cron: "*/15 0-23/2 1,15,31 1-12 0,7", timezone: "UTC" })).toEqual({
      cron: "*/15 0-23/2 1,15,31 1-12 0,7",
      timezone: "UTC",
    });
    expect(() => normalizeWorkflowSchedule({ cron: "0 0 8 * * *", timezone: "UTC" })).toThrow("exactly five fields");
    expect(() => normalizeWorkflowSchedule({ cron: "0 8 * * *", timezone: "Not/AZone" })).toThrow("IANA timezone");
  });

  test("rejects cron values outside each field range", () => {
    const invalid = [
      ["60 8 * * *", "minute"],
      ["0 24 * * *", "hour"],
      ["0 8 0 * *", "day-of-month"],
      ["0 8 * 13 *", "month"],
      ["0 8 * * 8", "day-of-week"],
    ] as const;

    for (const [cron, field] of invalid) {
      expect(() => normalizeWorkflowSchedule({ cron, timezone: "UTC" })).toThrow(`cron ${field} field`);
    }
  });

  test("rejects malformed lists, ranges, steps, names, and extensions", () => {
    for (const cron of ["1,,2 8 * * *", "10-5 8 * * *", "*/0 8 * * *", "0 8 * JAN *", "0 8 * * MON", "0 8 L * *", "0 8 * * 1#2"]) {
      expect(() => normalizeWorkflowSchedule({ cron, timezone: "UTC" })).toThrow("cron");
    }
    expect(normalizeWorkflowSchedule({ cron: "0 8 * * 6-1", timezone: "UTC" }).cron).toBe("0 8 * * 6-1");
    expect(() => normalizeWorkflowSchedule({ cron: "0 0 31 2 *", timezone: "UTC" })).toThrow("no reachable calendar date");
  });

  test("keeps registration identity stable across workflow revisions", () => {
    const first = registration("workflow-1", "3");
    const same = registration("workflow-1", "3", " 0  8 * * * ");
    const next = registration("workflow-1", "4");

    expect(first.id).toBe(same.id);
    expect(first.id).toBe(next.id);
    expect(first).not.toHaveProperty("channel");
    expect(first).not.toHaveProperty("manual");
  });

  test("derives deterministic slot keys from normalized instants", () => {
    const id = registration("workflow-1", "3").id;

    expect(workflowScheduleSlotKey(id, "2026-07-15T08:00:00.000Z")).toBe(workflowScheduleSlotKey(id, "2026-07-15T10:00:00.000+02:00"));
    expect(workflowScheduleSlotKey(id, "2026-07-15T08:00:00.000Z")).not.toBe(workflowScheduleSlotKey(id, "2026-07-16T08:00:00.000Z"));
    expect(() => workflowScheduleSlotKey(id, "2026-07-15T08:00:00")).toThrow("timezone");
  });

  test("reconciles a revision replacement as an update", () => {
    const current = registration("workflow-1", "1");
    const desired = registration("workflow-1", "2");

    expect(planWorkflowScheduleReconciliation([desired], [current])).toEqual({
      create: [],
      update: [{ current, desired }],
      remove: [],
    });
  });

  test("reconciles create, update, and remove through callbacks", async () => {
    const create = registration("create", "1");
    const desiredUpdate = registration("update", "1", "0 9 * * *");
    const currentUpdate = { ...desiredUpdate, schedule: { ...desiredUpdate.schedule, cron: "0 8 * * *" } };
    const remove = registration("remove", "1");
    const unchanged = registration("unchanged", "1");
    const calls: string[] = [];
    const port = {
      create: mock(async (item: typeof create) => {
        calls.push(`create:${item.workflowId}`);
      }),
      update: mock(async (_current: typeof create, desired: typeof create) => {
        calls.push(`update:${desired.workflowId}`);
      }),
      remove: mock(async (item: typeof create) => {
        calls.push(`remove:${item.workflowId}`);
      }),
    };

    const result = await reconcileWorkflowSchedules({
      desired: [unchanged, desiredUpdate, create],
      current: [remove, currentUpdate, unchanged],
      port,
    });

    expect(result.create).toEqual([create]);
    expect(result.update).toEqual([{ current: currentUpdate, desired: desiredUpdate }]);
    expect(result.remove).toEqual([remove]);
    expect(calls).toEqual(["create:create", "update:update", "remove:remove"]);
  });

  test("removes automatic registrations when none are desired", async () => {
    const current = registration("direct-only", "1");
    const remove = mock(async () => undefined);

    const result = await reconcileWorkflowSchedules({
      desired: [],
      current: [current],
      port: { create: async () => undefined, update: async () => undefined, remove },
    });

    expect(result.remove).toEqual([current]);
    expect(remove).toHaveBeenCalledWith(current);
  });
});
