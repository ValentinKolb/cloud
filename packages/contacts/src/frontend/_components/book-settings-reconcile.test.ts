import { describe, expect, test } from "bun:test";
import { createBlockedReconciliation, createQueuedReconciliation, settingsInteractionBlocked } from "./book-settings-reconcile";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("queued settings reconciliation", () => {
  test("keeps coverage pending while overlapping writes reload serially", async () => {
    const first = deferred();
    const second = deferred();
    const reloads = [first, second];
    const states: Array<{ reconciling: boolean; error: string | null }> = [];
    let calls = 0;
    const coverage = createQueuedReconciliation(
      () => reloads[calls++]!.promise,
      (state) => states.push(state),
    );

    coverage.run("first failed");
    coverage.run("second failed");
    expect(calls).toBe(1);
    expect(states.at(-1)).toEqual({ reconciling: true, error: null });

    first.resolve();
    await flush();
    expect(calls).toBe(2);
    expect(states.at(-1)).toEqual({ reconciling: true, error: null });

    second.resolve();
    await flush();
    expect(states.at(-1)).toEqual({ reconciling: false, error: null });
  });

  test("blocks on the failed reload and retry drains all queued coverage", async () => {
    const states: Array<{ reconciling: boolean; error: string | null }> = [];
    let calls = 0;
    const coverage = createQueuedReconciliation(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("offline");
      },
      (state) => states.push(state),
    );

    coverage.run("saved but not reloaded");
    coverage.run("second save not reloaded");
    await flush();
    expect(states.at(-1)).toEqual({ reconciling: false, error: "saved but not reloaded" });

    await coverage.retry();
    expect(calls).toBe(3);
    expect(states.at(-1)).toEqual({ reconciling: false, error: null });
  });
});

describe("blocked settings reconciliation", () => {
  test("blocks close and tab changes for writes, coverage, and unresolved coverage errors", () => {
    expect(
      settingsInteractionBlocked({ writePending: true, childWritePending: false, coveragePending: false, coverageError: false }),
    ).toBeTrue();
    expect(
      settingsInteractionBlocked({ writePending: false, childWritePending: true, coveragePending: false, coverageError: false }),
    ).toBeTrue();
    expect(
      settingsInteractionBlocked({ writePending: false, childWritePending: false, coveragePending: true, coverageError: false }),
    ).toBeTrue();
    expect(
      settingsInteractionBlocked({ writePending: false, childWritePending: false, coveragePending: false, coverageError: true }),
    ).toBeTrue();
    expect(
      settingsInteractionBlocked({ writePending: false, childWritePending: false, coveragePending: false, coverageError: false }),
    ).toBeFalse();
  });

  test("keeps the write pending until a failed reload is retried successfully", async () => {
    const states: Array<{ reconciling: boolean; error: string | null }> = [];
    let reloads = 0;
    const gate = createBlockedReconciliation(
      async () => {
        reloads += 1;
        if (reloads === 1) throw new Error("offline");
      },
      (state) => states.push(state),
    );
    let completed = false;

    const coverage = gate.run("saved but not reloaded").then(() => {
      completed = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(completed).toBeFalse();
    expect(states.at(-1)).toEqual({ reconciling: false, error: "saved but not reloaded" });

    await gate.retry();
    await coverage;

    expect(completed).toBeTrue();
    expect(states.at(-1)).toEqual({ reconciling: false, error: null });
  });
});
