import { describe, expect, test } from "bun:test";
import {
  recoverWorkflowDependencyDeadlines,
  type WorkflowDependencyDeadline,
  type WorkflowDependencyDeadlinePort,
  type WorkflowDependencyWake,
  type WorkflowDependencyWakePort,
  type WorkflowDependencyWakeResult,
} from "../runtime/dependency";

type WorkflowDependencyConformancePort = WorkflowDependencyWakePort & WorkflowDependencyDeadlinePort;

export type WorkflowDependencyConformanceHarness = {
  port: WorkflowDependencyConformancePort;
  wake: WorkflowDependencyWake;
  deadline: WorkflowDependencyDeadline;
  cancel(deadline: WorkflowDependencyDeadline): Promise<boolean>;
  advanceGeneration(): Promise<void>;
  restart(): Promise<WorkflowDependencyConformancePort>;
};

export const testWorkflowDependencyConformance = (
  name: string,
  createHarness: () => Promise<WorkflowDependencyConformanceHarness> | WorkflowDependencyConformanceHarness,
): void => {
  describe(name, () => {
    test("resumes once under concurrent at-least-once delivery", async () => {
      const harness = await createHarness();
      const results = await Promise.all(Array.from({ length: 8 }, () => harness.port.wake(harness.wake)));
      const resumed = results.filter(
        (result): result is Extract<WorkflowDependencyWakeResult, { state: "resumed" }> => result.state === "resumed",
      );
      const duplicates = results.filter(
        (result): result is Extract<WorkflowDependencyWakeResult, { state: "duplicate" }> => result.state === "duplicate",
      );

      expect(resumed).toHaveLength(1);
      expect(duplicates).toHaveLength(7);
      for (const duplicate of duplicates) {
        expect(duplicate.runId).toBe(resumed[0]!.runId);
        expect(duplicate.executionGeneration).toBe(resumed[0]!.executionGeneration);
      }
    });

    test("rejects a deadline from a stale execution generation", async () => {
      const harness = await createHarness();
      await harness.advanceGeneration();

      await expect(harness.port.expireDeadline(harness.deadline)).resolves.toEqual({ state: "ignored", reason: "stale" });
    });

    test("chooses exactly one winner in a cancellation and deadline race", async () => {
      const harness = await createHarness();
      const [canceled, expiration] = await Promise.all([harness.cancel(harness.deadline), harness.port.expireDeadline(harness.deadline)]);

      if (canceled) expect(expiration).toEqual({ state: "ignored", reason: "canceled" });
      else expect(expiration.state).toBe("expired");
    });

    test("restores due deadlines after a restart", async () => {
      const harness = await createHarness();
      const restartedPort = await harness.restart();
      const recovered = await recoverWorkflowDependencyDeadlines({
        now: harness.deadline.deadline,
        limit: 10,
        port: restartedPort,
      });

      expect(recovered).toHaveLength(1);
      expect(recovered[0]!.deadline).toEqual(harness.deadline);
      expect(recovered[0]!.result.state).toBe("expired");
      if (recovered[0]!.result.state === "expired") {
        expect(recovered[0]!.result.executionGeneration).toBeGreaterThan(harness.deadline.executionGeneration);
      }
    });
  });
};
