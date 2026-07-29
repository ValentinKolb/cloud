import { describe, expect, test } from "bun:test";
import { createMailPresenceSession } from "./mail-presence-session";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

describe("mail presence session", () => {
  test("keeps at most one heartbeat in flight", async () => {
    const pending = deferred<{ participants: string[] } | null>();
    let calls = 0;
    const snapshots: string[][] = [];
    const session = createMailPresenceSession({
      heartbeat: async () => {
        calls++;
        return pending.promise;
      },
      leave: async () => undefined,
      onSnapshot: (snapshot) => snapshots.push(snapshot.participants),
      requestTimeoutMs: 60_000,
    });

    const first = session.heartbeat();
    await session.heartbeat();
    expect(calls).toBe(1);

    pending.resolve({ participants: ["one"] });
    await first;
    expect(snapshots).toEqual([["one"]]);
    session.dispose();
  });

  test("aborts the active heartbeat and leaves exactly once on disposal", async () => {
    let heartbeatWasAborted = false;
    let leaveCalls = 0;
    const session = createMailPresenceSession({
      heartbeat: (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              heartbeatWasAborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
      leave: async () => {
        leaveCalls++;
      },
      onSnapshot: () => undefined,
      requestTimeoutMs: 60_000,
    });

    const active = session.heartbeat();
    session.dispose();
    session.dispose();
    await active;
    await Promise.resolve();

    expect(heartbeatWasAborted).toBeTrue();
    expect(leaveCalls).toBe(1);
  });

  test("releases the slot after a failed heartbeat", async () => {
    let calls = 0;
    const session = createMailPresenceSession({
      heartbeat: async () => {
        calls++;
        if (calls === 1) throw new Error("offline");
        return { participants: [] };
      },
      leave: async () => undefined,
      onSnapshot: () => undefined,
      requestTimeoutMs: 60_000,
    });

    await session.heartbeat();
    await session.heartbeat();
    expect(calls).toBe(2);
    session.dispose();
  });
});
