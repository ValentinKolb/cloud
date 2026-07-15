import { describe, expect, test } from "bun:test";
import { createRuntimeLifecycle, createRuntimeTaskTracker, stopRuntimeJobs, stopRuntimeResources } from "./runtime-lifecycle";

describe("runtime lifecycle", () => {
  test("drains every in-flight task", async () => {
    const tracker = createRuntimeTaskTracker();
    const completed: string[] = [];
    tracker.open();
    tracker.run(async () => completed.push("first"));
    tracker.run(async () => {
      throw new Error("expected failure");
    });

    await tracker.drain();

    expect(completed).toEqual(["first"]);
  });

  test("rejects new work after close", async () => {
    const tracker = createRuntimeTaskTracker();
    const completed: string[] = [];
    tracker.open();
    tracker.run(async () => {
      completed.push("outer");
      tracker.run(async () => completed.push("inner"));
    });
    tracker.close();

    expect(tracker.run(async () => completed.push("late"))).toBeNull();
    await tracker.drain();

    expect(completed).toEqual(["outer"]);
  });

  test("drains until the tracked set is stable", async () => {
    const tracker = createRuntimeTaskTracker();
    const completed: string[] = [];
    tracker.open();
    tracker.run(async () => {
      await Promise.resolve();
      tracker.run(async () => completed.push("inner"));
      completed.push("outer");
    });

    await tracker.drain();

    expect(completed).toEqual(["outer", "inner"]);
  });

  test("stops workers before and after draining accepted work", async () => {
    const tracker = createRuntimeTaskTracker();
    const events: string[] = [];
    let finish!: () => void;
    tracker.open();
    tracker.run(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      events.push("drained");
    });

    const stopping = stopRuntimeJobs(tracker, [{ stop: () => events.push("stopped") }]);
    await Promise.resolve();
    expect(events).toEqual(["stopped"]);
    finish();
    await stopping;

    expect(events).toEqual(["stopped", "drained", "stopped"]);
  });

  test("serializes duplicate starts and stops", async () => {
    let starts = 0;
    let stops = 0;
    const runtime = createRuntimeLifecycle({
      start: async () => {
        starts += 1;
        await Promise.resolve();
      },
      stop: async () => {
        stops += 1;
      },
    });

    await Promise.all([runtime.start(), runtime.start()]);
    await Promise.all([runtime.stop(), runtime.stop()]);

    expect({ starts, stops }).toEqual({ starts: 1, stops: 1 });
  });

  test("cleans up a partial start before allowing a retry", async () => {
    let starts = 0;
    let stops = 0;
    const runtime = createRuntimeLifecycle({
      start: async () => {
        starts += 1;
        if (starts === 1) throw new Error("startup failed");
      },
      stop: async () => {
        stops += 1;
      },
    });

    await expect(runtime.start()).rejects.toThrow("startup failed");
    await runtime.start();
    await runtime.stop();

    expect({ starts, stops }).toEqual({ starts: 2, stops: 2 });
  });

  test("keeps failed cleanup retryable", async () => {
    let stopAttempts = 0;
    const runtime = createRuntimeLifecycle({
      start: async () => {
        throw new Error("startup failed");
      },
      stop: async () => {
        stopAttempts += 1;
        if (stopAttempts === 1) throw new Error("cleanup failed");
      },
    });

    await expect(runtime.start()).rejects.toBeInstanceOf(AggregateError);
    await runtime.stop();

    expect(stopAttempts).toBe(2);
  });

  test("cleans up a failed stop before starting again", async () => {
    let starts = 0;
    let stopAttempts = 0;
    const runtime = createRuntimeLifecycle({
      start: async () => {
        starts += 1;
      },
      stop: async () => {
        stopAttempts += 1;
        if (stopAttempts === 1) throw new Error("cleanup failed");
      },
    });

    await runtime.start();
    await expect(runtime.stop()).rejects.toThrow("cleanup failed");
    await runtime.start();

    expect({ starts, stopAttempts }).toEqual({ starts: 2, stopAttempts: 2 });
  });

  test("attempts every teardown even when one fails", async () => {
    const stopped: string[] = [];
    await expect(
      stopRuntimeResources([
        () => {
          stopped.push("first");
          throw new Error("first failed");
        },
        () => {
          stopped.push("second");
        },
      ]),
    ).rejects.toThrow("first failed");
    expect(stopped).toEqual(["first", "second"]);
  });

  test("reports every teardown failure", async () => {
    const first = new Error("first failed");
    const second = new Error("second failed");

    try {
      await stopRuntimeResources([
        () => {
          throw first;
        },
        async () => {
          throw second;
        },
      ]);
      throw new Error("expected teardown to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([first, second]);
    }
  });
});
