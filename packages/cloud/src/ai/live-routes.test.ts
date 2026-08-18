import { describe, expect, test } from "bun:test";
import type { AiInvalidation } from "./live-events";
import { isAiLiveSubscriptionCurrent, parseAiLiveReplayEvent, resolveAiLiveCursor, resolveAiLiveSessionUser } from "./live-routes";

describe("AI live cursors", () => {
  test("rejects deleted and expired users behind an otherwise valid session", async () => {
    const session = async () => ({ userId: "user-1", gen: 1 });
    expect(await resolveAiLiveSessionUser("token", { getSession: session, getUser: async () => null })).toBeNull();
    const revoked: string[] = [];
    expect(
      await resolveAiLiveSessionUser("token", {
        getSession: session,
        getUser: async () => ({ id: "user-1", accountExpires: "2020-01-01T00:00:00.000Z" }) as never,
        revokeAllForUser: async (userId) => {
          revoked.push(userId);
        },
      }),
    ).toBeNull();
    expect(revoked).toEqual(["user-1"]);
  });

  test("uses the SSR cursor initially and the authoritative head for recovery", async () => {
    let latestReads = 0;
    const latest = async () => {
      latestReads += 1;
      return "9-2";
    };
    expect(await resolveAiLiveCursor("user-1", "8-1", false, latest)).toBe("8-1");
    expect(latestReads).toBe(0);
    expect(await resolveAiLiveCursor("user-1", "8-1", true, latest)).toBe("9-2");
    expect(await resolveAiLiveCursor("user-1", null, false, async () => null)).toBe("0-0");
  });

  test("validates cursors and events", () => {
    const event = {
      type: "ai.invalidated",
      changeId: crypto.randomUUID(),
      conversationId: "Chat01",
      projectId: null,
      domains: ["conversation-list"],
      at: "2026-08-12T16:00:00.000Z",
    } satisfies AiInvalidation;
    expect(parseAiLiveReplayEvent({ cursor: "10-1", data: event })).toEqual({ cursor: "10-1", event });
    expect(parseAiLiveReplayEvent({ cursor: "latest", data: event })).toBeNull();
  });

  test("rejects an old stream after reauthorization yields to a replacement subscription", async () => {
    const old = new AbortController();
    const state = { phase: "subscribed" as const, userId: "user-1" };
    let release!: () => void;
    const reauthorized = new Promise<void>((resolve) => {
      release = resolve;
    });
    const continuation = (async () => {
      await reauthorized;
      return isAiLiveSubscriptionCurrent(state, "user-1", old.signal);
    })();

    old.abort();
    release();
    expect(await continuation).toBe(false);
    expect(isAiLiveSubscriptionCurrent({ phase: "closing", userId: "user-1" }, "user-1", new AbortController().signal)).toBe(false);
  });
});
