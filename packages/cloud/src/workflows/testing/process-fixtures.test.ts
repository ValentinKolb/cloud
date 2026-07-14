import { describe, expect, test } from "bun:test";
import {
  bulkLauncherProcessFixture,
  directOnlyProcessFixture,
  recordEventProcessFixture,
  runWorkflowProcessFixture,
  scannerLauncherProcessFixture,
  scheduleProcessFixture,
  workflowProcessFixtures,
  workflowProcessManifest,
} from "./index";

describe("workflow process fixtures", () => {
  test("compile, bind, and execute through the shared workflow modules", async () => {
    for (const fixture of workflowProcessFixtures) {
      const result = await runWorkflowProcessFixture(fixture);
      expect(result.execution).toEqual({ state: "succeeded", output: fixture.expectedOutput });
      expect(result.plan.sourceHash).toBe(result.ir.sourceHash);
      expect(result.plan.bindings).toEqual(fixture.bindings);
      expect(result.finishedSteps.at(-1)?.result).toMatchObject({ mode: "execute", outcome: { state: "completed" } });
    }
  });

  test("represents direct-only workflows by omitting triggers", async () => {
    const result = await runWorkflowProcessFixture(directOnlyProcessFixture);
    expect(directOnlyProcessFixture.source).not.toContain("triggers:");
    expect(result.ir.triggers).toEqual([]);
    expect(result.plan.triggers).toEqual([]);
    expect(directOnlyProcessFixture.launchers).toEqual([]);
  });

  test("preserves schedule configuration and trigger-to-input bindings", async () => {
    const result = await runWorkflowProcessFixture(scheduleProcessFixture);
    expect(result.ir.triggers).toEqual([
      {
        kind: "schedule",
        config: { cron: "0 8 * * *", timezone: "Europe/Berlin" },
        with: { runAt: "${{ trigger.occurredAt }}" },
      },
    ]);
    expect(result.plan.triggers).toEqual(result.ir.triggers);
    expect(scheduleProcessFixture.invocation).toMatchObject({ channel: "schedule", inputs: { runAt: "2026-07-14T08:00:00.000Z" } });
  });

  test("preserves record event configuration and trigger-to-input bindings", async () => {
    const result = await runWorkflowProcessFixture(recordEventProcessFixture);
    expect(result.ir.triggers).toEqual([
      {
        kind: "recordEvent",
        config: { event: "updated", resource: "items" },
        with: { record: "${{ trigger.record }}" },
      },
    ]);
    expect(result.plan.bindings).toEqual({ resource: "resource-items" });
    expect(recordEventProcessFixture.invocation).toMatchObject({ channel: "event", inputs: { record: { id: "record-1" } } });
  });

  test("keeps scanner and bulk configuration in launchers, not triggers", async () => {
    expect(workflowProcessManifest.triggers.map((trigger) => trigger.kind)).toEqual(["schedule", "recordEvent"]);
    for (const fixture of [scannerLauncherProcessFixture, bulkLauncherProcessFixture]) {
      const result = await runWorkflowProcessFixture(fixture);
      expect(fixture.source).not.toContain("triggers:");
      expect(result.ir.triggers).toEqual([]);
      expect(fixture.launchers).toHaveLength(1);
      expect(fixture.launchers[0]).toMatchObject({ workflowId: fixture.workflowId, enabled: true, diagnostics: [] });
    }

    expect(scannerLauncherProcessFixture.launchers[0]).toMatchObject({
      kind: "scanner",
      config: { input: "record", resolution: { kind: "stableCode", resource: "items" }, processing: { maxPending: 4 } },
    });
    expect(bulkLauncherProcessFixture.launchers[0]).toMatchObject({
      kind: "bulk",
      config: { input: "records", selection: { resource: "items", maxItems: 100 } },
    });
  });
});
