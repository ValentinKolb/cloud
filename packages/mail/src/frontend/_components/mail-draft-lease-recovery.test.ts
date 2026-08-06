import { describe, expect, test } from "bun:test";
import type { AcquiredDraftLease } from "../../contracts";
import { recoverDraftLeaseHeartbeat } from "./mail-draft-lease-recovery";

const lease: AcquiredDraftLease = {
  token: "lease-token",
  holder: {
    kind: "user",
    id: "10000000-0000-4000-8000-000000000001",
    displayName: "Mail User",
    avatarHash: null,
  },
  acquiredAt: "2026-07-29T15:00:00.000Z",
  expiresAt: "2026-07-29T15:00:30.000Z",
};

describe("draft lease heartbeat recovery", () => {
  test("recovers automatically from transient transport failures", async () => {
    let attempts = 0;
    const result = await recoverDraftLeaseHeartbeat({
      heartbeat: async () => (++attempts < 3 ? { kind: "unavailable" } : { kind: "ok", lease }),
      signal: new AbortController().signal,
      retryBaseMs: 0,
      retryMaxMs: 0,
      retryJitter: 0,
    });

    expect(result).toEqual({ kind: "ok", lease });
    expect(attempts).toBe(3);
  });

  test("does not retry a confirmed lease rejection", async () => {
    let attempts = 0;
    const result = await recoverDraftLeaseHeartbeat({
      heartbeat: async () => {
        attempts++;
        return { kind: "rejected" };
      },
      signal: new AbortController().signal,
      retryBaseMs: 0,
      retryMaxMs: 0,
      retryJitter: 0,
    });

    expect(result).toEqual({ kind: "rejected" });
    expect(attempts).toBe(1);
  });

  test("stops after the bounded recovery window", async () => {
    let attempts = 0;
    const result = await recoverDraftLeaseHeartbeat({
      heartbeat: async () => {
        attempts++;
        return { kind: "unavailable" };
      },
      signal: new AbortController().signal,
      retryBaseMs: 0,
      retryMaxMs: 0,
      retryJitter: 0,
    });

    expect(result).toEqual({ kind: "unavailable" });
    expect(attempts).toBe(3);
  });

  test("honors lifecycle cancellation between attempts", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const recovery = recoverDraftLeaseHeartbeat({
      heartbeat: async () => {
        attempts++;
        controller.abort();
        return { kind: "unavailable" };
      },
      signal: controller.signal,
      retryBaseMs: 10,
      retryMaxMs: 10,
      retryJitter: 0,
    });

    await expect(recovery).rejects.toMatchObject({ name: "AbortError" });
    expect(attempts).toBe(1);
  });
});
