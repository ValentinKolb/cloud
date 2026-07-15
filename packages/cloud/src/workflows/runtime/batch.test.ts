import { describe, expect, mock, test } from "bun:test";
import { materializeWorkflowBatchSlice, processWorkflowBatchSlice, type WorkflowBatchClaim, workflowBatchChildKey } from "./batch";

type Claim = WorkflowBatchClaim<{ id: string }, { generation: number }>;

const claims: Claim[] = [
  { targetKey: "target:1", snapshot: { id: "1" }, token: { generation: 1 } },
  { targetKey: "target:2", snapshot: { id: "2" }, token: { generation: 1 } },
  { targetKey: "target:3", snapshot: { id: "3" }, token: { generation: 1 } },
];

describe("workflow batches", () => {
  test("derives collision-safe deterministic child keys", () => {
    expect(workflowBatchChildKey("batch:1", "target:2")).toBe(workflowBatchChildKey("batch:1", "target:2"));
    expect(workflowBatchChildKey("batch:1", "target:2")).not.toBe(workflowBatchChildKey("batch", "1:target:2"));
  });

  test("materializes one bounded keyset slice and returns cursor progress only", async () => {
    const materialize = mock(async ({ targets }: { targets: ReadonlyArray<{ childKey: string }> }) => ({
      accepted: targets.length,
      created: targets.length,
    }));
    const result = await materializeWorkflowBatchSlice({
      batchId: "batch-1",
      cursor: { after: "target:0" },
      limit: 2,
      control: async () => "active",
      discover: async () => ({ targets: claims.slice(0, 2), nextCursor: { after: "target:2" } }),
      materialize,
    });

    expect(result).toEqual({
      state: "more",
      cursor: { after: "target:2" },
      discovered: 2,
      created: 2,
    });
    expect(result).not.toHaveProperty("targets");
    expect(materialize.mock.calls[0]?.[0].targets.map((target) => target.childKey)).toEqual([
      workflowBatchChildKey("batch-1", "target:1"),
      workflowBatchChildKey("batch-1", "target:2"),
    ]);
  });

  test("does not discover targets while paused", async () => {
    const discover = mock(async () => ({ targets: claims, nextCursor: null }));

    const result = await materializeWorkflowBatchSlice({
      batchId: "batch-1",
      cursor: null,
      limit: 3,
      control: async () => "paused",
      discover,
      materialize: async () => ({ accepted: 0, created: 0 }),
    });

    expect(result).toEqual({ state: "paused", cursor: null, discovered: 0, created: 0 });
    expect(discover).not.toHaveBeenCalled();
  });

  test("does not advance the cursor unless every discovered target was accepted", async () => {
    await expect(
      materializeWorkflowBatchSlice({
        batchId: "batch-1",
        cursor: null,
        limit: 2,
        control: async () => "active",
        discover: async () => ({ targets: claims.slice(0, 2), nextCursor: null }),
        materialize: async () => ({ accepted: 1, created: 1 }),
      }),
    ).rejects.toThrow("atomically accept every discovered target");
  });

  test("isolates failed and needs-attention targets", async () => {
    const committed: string[] = [];
    const result = await processWorkflowBatchSlice({
      batchId: "batch-1",
      limit: 3,
      control: async () => "active",
      claim: async () => ({ targets: claims, hasMore: false }),
      process: async ({ claim }) => {
        if (claim.targetKey === "target:2") throw new Error("temporary target failure");
        if (claim.targetKey === "target:3") return { state: "needs_attention", error: { code: "UNKNOWN_OUTCOME" } } as const;
        return { state: "completed", output: { changed: true } } as const;
      },
      onError: () => ({ state: "failed", error: { code: "TARGET_FAILED" } }),
      commit: async ({ claim }) => {
        committed.push(claim.targetKey);
      },
      release: async () => undefined,
    });

    expect(result).toEqual({
      state: "complete",
      claimed: 3,
      processed: 3,
      completed: 1,
      failed: 1,
      needsAttention: 1,
      released: 0,
    });
    expect(committed).toEqual(["target:1", "target:2", "target:3"]);
  });

  test("stops between targets and releases unprocessed claims when paused", async () => {
    const controls: Array<"active" | "paused"> = ["active", "active", "paused"];
    const released: string[] = [];
    const result = await processWorkflowBatchSlice({
      batchId: "batch-1",
      limit: 3,
      control: async () => controls.shift() ?? "paused",
      claim: async () => ({ targets: claims, hasMore: true }),
      process: async () => ({ state: "completed" }),
      onError: () => ({ state: "failed", error: { code: "FAILED" } }),
      commit: async () => undefined,
      release: async (claim) => {
        released.push(claim.targetKey);
      },
    });

    expect(result).toEqual({
      state: "paused",
      claimed: 3,
      processed: 1,
      completed: 1,
      failed: 0,
      needsAttention: 0,
      released: 2,
    });
    expect(released).toEqual(["target:2", "target:3"]);
  });

  test("does not claim targets after cancellation", async () => {
    const claim = mock(async () => ({ targets: claims, hasMore: false }));

    const result = await processWorkflowBatchSlice({
      batchId: "batch-1",
      limit: 3,
      control: async () => "canceled",
      claim,
      process: async () => ({ state: "completed" }),
      onError: () => ({ state: "failed", error: { code: "FAILED" } }),
      commit: async () => undefined,
      release: async () => undefined,
    });

    expect(result.state).toBe("canceled");
    expect(result.claimed).toBe(0);
    expect(claim).not.toHaveBeenCalled();
  });

  test("releases unstarted claims when commit throws", async () => {
    const released: string[] = [];
    await expect(
      processWorkflowBatchSlice({
        batchId: "batch-1",
        limit: 3,
        control: async () => "active",
        claim: async () => ({ targets: claims, hasMore: false }),
        process: async () => ({ state: "completed" }),
        onError: () => ({ state: "failed", error: { code: "FAILED" } }),
        commit: async () => {
          throw new Error("commit failed");
        },
        release: async (claim) => {
          released.push(claim.targetKey);
        },
      }),
    ).rejects.toThrow("commit failed");
    expect(released).toEqual(["target:2", "target:3"]);
  });
});
