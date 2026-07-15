import { describe, expect, mock, test } from "bun:test";
import { coordinateWorkflowExecution, type WorkflowCoordinatorClaim, type WorkflowCoordinatorPort } from "./coordinator";

type Claim = WorkflowCoordinatorClaim & { owner: string };

const claim: Claim = { runId: "run-1", executionGeneration: 3, owner: "worker-1" };

const coordinatorPort = (
  overrides: Partial<WorkflowCoordinatorPort<string, Claim, string>> = {},
): WorkflowCoordinatorPort<string, Claim, string> => ({
  claim: async () => claim,
  renew: async () => ({ state: "active" }),
  finish: async () => ({ state: "finished" }),
  release: async () => ({ state: "retry" }),
  ...overrides,
});

describe("workflow coordinator", () => {
  test("returns idle when no run can be claimed", async () => {
    const result = await coordinateWorkflowExecution({
      input: "run-1",
      heartbeatMs: 1_000,
      port: coordinatorPort({ claim: async () => null }),
      execute: async () => "done",
    });

    expect(result).toEqual({ state: "idle" });
  });

  test("does not finish a stale generation", async () => {
    const finish = mock(async () => ({ state: "finished" }) as const);
    const release = mock(async () => ({ state: "retry" }) as const);
    const result = await coordinateWorkflowExecution({
      input: "run-1",
      heartbeatMs: 1_000,
      port: coordinatorPort({ renew: async () => ({ state: "stale" }), finish, release }),
      execute: async ({ heartbeat, signal }) => {
        expect(await heartbeat()).toEqual({ state: "stale" });
        expect(signal.aborted).toBe(true);
        return "ignored";
      },
    });

    expect(result).toEqual({ state: "stale", claim });
    expect(finish).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  test("aborts execution when a heartbeat observes cancellation", async () => {
    const finish = mock(async () => ({ state: "finished" }) as const);
    const release = mock(async () => ({ state: "retry" }) as const);
    const result = await coordinateWorkflowExecution({
      input: "run-1",
      heartbeatMs: 1,
      port: coordinatorPort({ renew: async () => ({ state: "canceled", message: "revoked" }), finish, release }),
      execute: ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    });

    expect(result).toEqual({ state: "canceled", claim, message: "revoked" });
    expect(finish).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  test("releases an execution error once for retry", async () => {
    const error = new Error("temporary failure");
    const finish = mock(async () => ({ state: "finished" }) as const);
    const release = mock(async () => ({ state: "retry", retryAt: "2026-07-15T12:00:00.000Z" }) as const);
    const result = await coordinateWorkflowExecution({
      input: "run-1",
      heartbeatMs: 1_000,
      port: coordinatorPort({ finish, release }),
      execute: async () => {
        throw error;
      },
    });

    expect(result).toEqual({
      state: "retry",
      claim,
      error,
      retryAt: "2026-07-15T12:00:00.000Z",
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(claim, error);
    expect(finish).not.toHaveBeenCalled();
  });

  test("releases instead of crashing when renew throws synchronously", async () => {
    const error = new Error("renew failed before returning a promise");
    const finish = mock(async () => ({ state: "finished" }) as const);
    const release = mock(async () => ({ state: "released" }) as const);
    const result = await coordinateWorkflowExecution({
      input: "run-1",
      heartbeatMs: 1_000,
      port: coordinatorPort({
        renew: (() => {
          throw error;
        }) as WorkflowCoordinatorPort<string, Claim, string>["renew"],
        finish,
        release,
      }),
      execute: async ({ heartbeat }) => {
        await expect(heartbeat()).rejects.toBe(error);
        return "ignored";
      },
    });

    expect(result).toEqual({ state: "released", claim, error });
    expect(release).toHaveBeenCalledWith(claim, error);
    expect(finish).not.toHaveBeenCalled();
  });

  test("does not finish when an in-flight renewal becomes stale", async () => {
    let resolveRenew!: (state: { state: "stale" }) => void;
    const renewal = new Promise<{ state: "stale" }>((resolve) => {
      resolveRenew = resolve;
    });
    const finish = mock(async () => ({ state: "finished" }) as const);
    const release = mock(async () => ({ state: "released" }) as const);
    const execution = coordinateWorkflowExecution({
      input: "run-1",
      heartbeatMs: 1_000,
      port: coordinatorPort({ renew: () => renewal, finish, release }),
      execute: async ({ heartbeat }) => {
        void heartbeat();
        return "ignored";
      },
    });

    await Bun.sleep(0);
    resolveRenew({ state: "stale" });
    expect(await execution).toEqual({ state: "stale", claim });
    expect(finish).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  test("cleans up the heartbeat timer before returning", async () => {
    let renewals = 0;
    let retainedHeartbeat: (() => Promise<unknown>) | undefined;
    await coordinateWorkflowExecution({
      input: "run-1",
      heartbeatMs: 2,
      port: coordinatorPort({
        renew: async () => {
          renewals += 1;
          return { state: "active" };
        },
      }),
      execute: async ({ heartbeat }) => {
        retainedHeartbeat = heartbeat;
        await Bun.sleep(8);
        return "done";
      },
    });
    const renewalsAtFinish = renewals;

    await Bun.sleep(8);
    await retainedHeartbeat?.();

    expect(renewalsAtFinish).toBeGreaterThan(0);
    expect(renewals).toBe(renewalsAtFinish);
  });

  test("never retries finish when its outcome is uncertain", async () => {
    const finish = mock(async () => {
      throw new Error("finish response lost");
    });
    const release = mock(async () => ({ state: "retry" }) as const);

    await expect(
      coordinateWorkflowExecution({
        input: "run-1",
        heartbeatMs: 1_000,
        port: coordinatorPort({ finish, release }),
        execute: async () => "done",
      }),
    ).rejects.toThrow("finish response lost");
    expect(finish).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });
});
