import { describe, expect, mock, test } from "bun:test";
import type { WorkflowDependency } from "../contracts";
import {
  createWorkflowDependencyDeadline,
  createWorkflowDependencyWake,
  recoverWorkflowDependencyDeadlines,
  wakeWorkflowDependency,
  workflowDependencyIdentity,
} from "./dependency";

describe("workflow dependencies", () => {
  test("derives stable opaque identity from kind and key only", () => {
    const dependency: WorkflowDependency = {
      kind: "mail.command",
      key: "command:1",
      deadline: "2026-07-15T12:00:00.000Z",
    };
    const updated: WorkflowDependency = {
      ...dependency,
      deadline: "2026-07-16T12:00:00.000Z",
      data: { state: "new" },
    };

    expect(workflowDependencyIdentity(dependency)).toBe(workflowDependencyIdentity(updated));
    expect(workflowDependencyIdentity({ kind: "mail", key: ".command:1" })).not.toBe(workflowDependencyIdentity(dependency));
  });

  test("derives one wake identity per dependency delivery", async () => {
    const wake = createWorkflowDependencyWake(
      { kind: "mail.command", key: "command:1" },
      { deliveryKey: "provider-event:7", occurredAt: "2026-07-15T11:00:00.000Z", data: { status: "sent" } },
    );
    const port = {
      wake: mock(async () => ({ state: "resumed", runId: "run-1", executionGeneration: 4 }) as const),
    };

    await expect(wakeWorkflowDependency(port, wake)).resolves.toEqual({
      state: "resumed",
      runId: "run-1",
      executionGeneration: 4,
    });
    expect(port.wake).toHaveBeenCalledWith(wake);
    expect(wake.occurredAt).toBe("2026-07-15T11:00:00.000Z");
    expect(
      createWorkflowDependencyWake(
        { kind: "mail.command", key: "command:1" },
        { deliveryKey: "provider-event:7", occurredAt: "2026-07-15T11:01:00.000Z" },
      ).wakeId,
    ).toBe(wake.wakeId);
  });

  test("creates a generation-fenced deadline identity", () => {
    const dependency = { kind: "mail.command", key: "command:1", deadline: "2026-07-15T14:00:00+02:00" };
    const deadline = createWorkflowDependencyDeadline(dependency, { runId: " run-1 ", executionGeneration: 4 });

    expect(deadline).toMatchObject({
      dependencyId: workflowDependencyIdentity(dependency),
      runId: "run-1",
      executionGeneration: 4,
      deadline: "2026-07-15T12:00:00.000Z",
    });
    expect(createWorkflowDependencyDeadline(dependency, { runId: "run-1", executionGeneration: 4 }).deadlineId).toBe(deadline.deadlineId);
    expect(createWorkflowDependencyDeadline(dependency, { runId: "run-1", executionGeneration: 5 }).deadlineId).not.toBe(
      deadline.deadlineId,
    );
  });

  test("recovers a bounded set of due deadlines", async () => {
    const deadline = createWorkflowDependencyDeadline(
      { kind: "mail.command", key: "command:1", deadline: "2026-07-15T12:00:00.000Z" },
      { runId: "run-1", executionGeneration: 4 },
    );
    const listDueDeadlines = mock(async () => [deadline]);
    const expireDeadline = mock(async () => ({ state: "expired", runId: "run-1", executionGeneration: 5 }) as const);

    await expect(
      recoverWorkflowDependencyDeadlines({
        now: "2026-07-15T14:00:00+02:00",
        limit: 10,
        port: { listDueDeadlines, expireDeadline },
      }),
    ).resolves.toEqual([{ deadline, result: { state: "expired", runId: "run-1", executionGeneration: 5 } }]);
    expect(listDueDeadlines).toHaveBeenCalledWith({ now: "2026-07-15T12:00:00.000Z", limit: 10 });
    expect(expireDeadline).toHaveBeenCalledWith(deadline);
  });

  test("rejects invalid deadlines and invalid recovery batches", async () => {
    expect(() =>
      createWorkflowDependencyDeadline(
        { kind: "mail.command", key: "command:1", deadline: "2026-07-15T12:00:00" },
        { runId: "run-1", executionGeneration: 1 },
      ),
    ).toThrow("timezone");

    await expect(
      recoverWorkflowDependencyDeadlines({
        now: "2026-07-15T12:00:00.000Z",
        limit: 1,
        port: {
          listDueDeadlines: async () => [
            createWorkflowDependencyDeadline(
              { kind: "mail.command", key: "command:1", deadline: "2026-07-15T12:01:00.000Z" },
              { runId: "run-1", executionGeneration: 1 },
            ),
          ],
          expireDeadline: async () => ({ state: "ignored", reason: "not_due" }),
        },
      }),
    ).rejects.toThrow("future deadline");
  });
});
