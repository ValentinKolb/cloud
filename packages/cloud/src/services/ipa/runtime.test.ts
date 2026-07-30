import { describe, expect, test } from "bun:test";
import { createIpaRuntimeCheckpoint } from "./runtime";

describe("createIpaRuntimeCheckpoint", () => {
  test("heartbeats a slow operation without refreshing on every item", async () => {
    let time = 0;
    let heartbeats = 0;
    const checkpoint = createIpaRuntimeCheckpoint(
      {
        heartbeat: async () => {
          heartbeats += 1;
        },
      },
      { intervalMs: 30_000, now: () => time },
    );

    await checkpoint();
    time = 10_000;
    await checkpoint();
    time = 30_000;
    await checkpoint();

    expect(heartbeats).toBe(2);
  });

  test("supports phase-boundary forced heartbeats", async () => {
    let heartbeats = 0;
    const checkpoint = createIpaRuntimeCheckpoint({
      heartbeat: async () => {
        heartbeats += 1;
      },
    });

    await checkpoint();
    await checkpoint(true);

    expect(heartbeats).toBe(2);
  });

  test("aborts before later mutation work and after lease loss", async () => {
    const beforeWork = new AbortController();
    beforeWork.abort();
    const cancelled = createIpaRuntimeCheckpoint({ signal: beforeWork.signal });
    await expect(cancelled()).rejects.toMatchObject({ name: "AbortError" });

    const duringHeartbeat = new AbortController();
    const lost = createIpaRuntimeCheckpoint({
      signal: duringHeartbeat.signal,
      heartbeat: async () => duringHeartbeat.abort(),
    });
    await expect(lost()).rejects.toMatchObject({ name: "AbortError" });
  });
});
