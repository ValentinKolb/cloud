import { describe, expect, test } from "bun:test";
import { wakeWorkflowRunBestEffort } from "./wake";

describe("workflow run wake", () => {
  test("wakes an explicitly composed transport", async () => {
    const runs: string[] = [];
    await wakeWorkflowRunBestEffort({
      runId: "run-1",
      wake: async (runId) => {
        runs.push(runId);
      },
      onError: () => undefined,
    });

    expect(runs).toEqual(["run-1"]);
  });

  test("reports transport failure without changing durable success", async () => {
    const errors: unknown[] = [];
    await wakeWorkflowRunBestEffort({
      runId: "run-1",
      wake: async () => {
        throw new Error("queue unavailable");
      },
      onError: (error) => errors.push(error),
    });

    expect(errors).toEqual([expect.objectContaining({ message: "queue unavailable" })]);
  });
});
