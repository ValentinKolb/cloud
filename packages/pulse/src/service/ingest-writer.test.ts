import { describe, expect, mock, test } from "bun:test";

let beginCalls = 0;
let activeChecks = 0;

const sqlMock = Object.assign(
  () => {
    throw new Error("SQL should not run for invalid ingest preflight");
  },
  {
    begin: async () => {
      beginCalls += 1;
      throw new Error("Transaction should not start for invalid ingest preflight");
    },
  },
);

mock.module("bun", () => ({ sql: sqlMock }));
mock.module("./access-control", () => ({
  requireBaseAccess: async () => {
    throw new Error("Base access check should not run for invalid ingest preflight");
  },
  requireBaseActive: async () => {
    activeChecks += 1;
    throw new Error("Base active check should not run for invalid ingest preflight");
  },
}));

const { ingestBatch, recordEvent, recordMetric, setState } = await import("./ingest-writer");

describe("Pulse ingest writer", () => {
  test("rejects a mixed batch with an invalid later item before opening a transaction", async () => {
    beginCalls = 0;
    activeChecks = 0;

    const result = await ingestBatch({
      baseId: "103546c5-be8f-47e3-9239-a27c70b47abc",
      sourceId: "6c18f8db-e778-41a5-8517-7cd89cb552d6",
      batch: {
        metrics: [{ name: "system.cpu.usage", value: 12, type: "gauge" }],
        states: [{ key: "system.online", value: true, ts: "not a timestamp" }],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BAD_INPUT");
    expect(result.error.message).toBe("Invalid timestamp");
    expect(activeChecks).toBe(0);
    expect(beginCalls).toBe(0);
  });

  test("rejects excessive event dimensions before opening a transaction", async () => {
    beginCalls = 0;
    activeChecks = 0;

    const result = await ingestBatch({
      baseId: "103546c5-be8f-47e3-9239-a27c70b47abc",
      sourceId: "6c18f8db-e778-41a5-8517-7cd89cb552d6",
      batch: {
        events: [
          {
            kind: "page.viewed",
            dimensions: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`key_${index}`, `value_${index}`])),
          },
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("Dimensions cannot exceed 32 keys");
    expect(activeChecks).toBe(0);
    expect(beginCalls).toBe(0);
  });

  test("runs full validation for direct metric, event, and state writers before SQL", async () => {
    beginCalls = 0;
    activeChecks = 0;
    const baseId = "103546c5-be8f-47e3-9239-a27c70b47abc";

    const metric = await recordMetric({
      baseId,
      metric: {
        name: "system.cpu",
        value: 1,
        dimensions: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`key_${index}`, "value"])),
      },
    });
    const event = await recordEvent({ baseId, event: { kind: "page.viewed", value: Number.POSITIVE_INFINITY } });
    const state = await setState({ baseId, state: { key: "system.load", value: Number.NaN } });

    expect(metric).toMatchObject({ ok: false, error: { code: "BAD_INPUT", message: "Dimensions cannot exceed 32 keys" } });
    expect(event).toMatchObject({ ok: false, error: { code: "BAD_INPUT", message: "Event value must be finite" } });
    expect(state).toMatchObject({ ok: false, error: { code: "BAD_INPUT", message: "State value must be finite" } });
    expect(activeChecks).toBe(0);
    expect(beginCalls).toBe(0);
  });
});
