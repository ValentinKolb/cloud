import { describe, expect, test } from "bun:test";
import { serializeWorkspaceState } from "./workspace-state-serialization";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("workspace state serialization", () => {
  test("serializes state work for the same base", async () => {
    const first = deferred<void>();
    const started = deferred<void>();
    const order: string[] = [];
    const one = serializeWorkspaceState("BASE01", async () => {
      order.push("one:start");
      started.resolve();
      await first.promise;
      order.push("one:end");
    });
    const two = serializeWorkspaceState("BASE01", async () => {
      order.push("two");
    });

    await started.promise;
    expect(order).toEqual(["one:start"]);
    first.resolve();
    await Promise.all([one, two]);
    expect(order).toEqual(["one:start", "one:end", "two"]);
  });

  test("does not block another base and releases after errors", async () => {
    const first = deferred<void>();
    const one = serializeWorkspaceState("BASE02", async () => {
      await first.promise;
      throw new Error("failed");
    });
    const other = serializeWorkspaceState("BASE03", async () => "other");
    expect(await other).toBe("other");
    first.resolve();
    await expect(one).rejects.toThrow("failed");
    expect(await serializeWorkspaceState("BASE02", async () => "recovered")).toBe("recovered");
  });

  test("does not start queued work after its request was aborted", async () => {
    const first = deferred<void>();
    const started = deferred<void>();
    const one = serializeWorkspaceState("BASE04", async () => {
      started.resolve();
      await first.promise;
    });
    await started.promise;
    const controller = new AbortController();
    let secondStarted = false;
    const two = serializeWorkspaceState(
      "BASE04",
      async () => {
        secondStarted = true;
      },
      controller.signal,
    );
    controller.abort(new Error("gone"));
    first.resolve();

    await one;
    await expect(two).rejects.toThrow("gone");
    expect(secondStarted).toBe(false);
  });
});
