import { describe, expect, test } from "bun:test";
import { createSerializedDraftMutationQueue } from "./mail-draft-session";

describe("createSerializedDraftMutationQueue", () => {
  test("serializes operations and continues after a rejection", async () => {
    const serialize = createSerializedDraftMutationQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = serialize(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      throw new Error("expected");
    });
    const second = serialize(async () => {
      events.push("second");
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst?.();
    await expect(first).rejects.toThrow("expected");
    expect(await second).toBe(2);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });
});
