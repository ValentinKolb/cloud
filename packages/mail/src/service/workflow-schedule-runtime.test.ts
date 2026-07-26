import { describe, expect, test } from "bun:test";
import { mailWorkflowScheduleRegistration } from "./workflow-schedule-runtime";

const workflowId = "10000000-0000-4000-8000-000000000001";

describe("Mail workflow schedule registration", () => {
  test("normalizes schedules and keeps one stable scheduler identity", () => {
    const first = mailWorkflowScheduleRegistration({
      workflowId,
      triggerKey: "schedule:0",
      revision: 1,
      cron: " 0  8 * * * ",
      timezone: "Europe/Berlin",
    });
    const next = mailWorkflowScheduleRegistration({
      workflowId,
      triggerKey: "schedule:0",
      revision: 2,
      cron: "0 9 * * *",
      timezone: "Europe/Berlin",
    });

    const firstId = first.id;
    expect(firstId.startsWith("mail:workflow-schedule:")).toBe(true);
    expect(first).toMatchObject({
      namespace: "mail",
      workflowId,
      triggerId: "schedule:0",
      revision: "1",
      schedule: { cron: "0 8 * * *", timezone: "Europe/Berlin" },
    });
    expect(next.id).toBe(firstId);
    expect(next.revision).toBe("2");
  });
});
