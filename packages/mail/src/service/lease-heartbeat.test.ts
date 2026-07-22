import { describe, expect, test } from "bun:test";
import { withLeaseHeartbeat } from "./lease-heartbeat";

describe("mail job lease heartbeat", () => {
  test("renews a lease while work is running", async () => {
    let beats = 0;
    const result = await withLeaseHeartbeat({
      intervalMs: 5,
      heartbeat: async () => {
        beats += 1;
      },
      work: async () => {
        await Bun.sleep(18);
        return "done";
      },
    });

    expect(result).toBe("done");
    expect(beats).toBeGreaterThanOrEqual(1);
  });

  test("surfaces a failed heartbeat before work starts", async () => {
    const leaseError = new Error("lease lost");
    await expect(
      withLeaseHeartbeat({
        intervalMs: 5,
        heartbeat: async () => {
          throw leaseError;
        },
        work: async () => undefined,
      }),
    ).rejects.toBe(leaseError);
  });

  test("blocks provider work when the lease cannot be renewed", async () => {
    let sideEffectStarted = false;
    await expect(
      withLeaseHeartbeat({
        intervalMs: 10,
        heartbeat: async () => {
          throw new Error("lease lost");
        },
        work: async (assertLeaseActive) => {
          await assertLeaseActive();
          sideEffectStarted = true;
        },
      }),
    ).rejects.toThrow("lease lost");
    expect(sideEffectStarted).toBe(false);
  });

  test("aborts active provider work when a later heartbeat loses the lease", async () => {
    const leaseError = new Error("lease lost during provider work");
    let beats = 0;
    let observedReason: unknown;
    await expect(
      withLeaseHeartbeat({
        intervalMs: 5,
        heartbeat: async () => {
          beats += 1;
          if (beats > 1) throw leaseError;
        },
        work: async (_assertLeaseActive, signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                observedReason = signal.reason;
                resolve();
              },
              { once: true },
            );
          });
        },
      }),
    ).rejects.toBe(leaseError);
    expect(observedReason).toBe(leaseError);
  });
});
