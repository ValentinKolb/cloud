import { describe, expect, test } from "bun:test";
import type { StoreEntry } from "@valentinkolb/nessi";
import { __compactionTest } from "./compaction";

describe("AI compaction split", () => {
  const messageEntry = (seq: number, role: "user" | "assistant"): StoreEntry => ({
    seq,
    kind: "message",
    message:
      role === "user"
        ? { role, content: [{ type: "text", text: `User ${seq}` }] }
        : { role, content: [{ type: "text", text: `Assistant ${seq}` }] },
  });

  test("splits at user-message loop boundaries", () => {
    const entries: StoreEntry[] = [
      messageEntry(1, "user"),
      messageEntry(2, "assistant"),
      { seq: 3, kind: "message", message: { role: "tool_result", callId: "call-1", name: "tool", result: { ok: true } } },
      messageEntry(4, "user"),
      messageEntry(5, "assistant"),
      messageEntry(6, "user"),
      messageEntry(7, "assistant"),
      messageEntry(8, "user"),
    ];

    expect(__compactionTest.countConversationLoops(entries)).toBe(4);
    expect(__compactionTest.findLoopSplitIndex(entries, 2)).toBe(5);
    expect(entries.slice(0, __compactionTest.findLoopSplitIndex(entries, 2)).map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  test("keeps more recent loops when context pressure is lower", () => {
    expect(__compactionTest.keepLoopsForFillRatio(undefined, 10)).toBe(2);
    expect(__compactionTest.keepLoopsForFillRatio(0.75, 10)).toBe(3);
    expect(__compactionTest.keepLoopsForFillRatio(0.95, 10)).toBe(2);
  });

  test("manual compaction (keep 1 loop) splits right before the latest user message", () => {
    const entries: StoreEntry[] = [
      messageEntry(1, "user"),
      messageEntry(2, "assistant"),
      messageEntry(3, "user"),
      messageEntry(4, "assistant"),
      messageEntry(5, "user"),
      messageEntry(6, "assistant"),
    ];

    // keepLoops = 1: everything before the last user message goes into the summary.
    expect(__compactionTest.findLoopSplitIndex(entries, 1)).toBe(4);
    expect(entries.slice(0, 4).map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
  });
});
