import { describe, expect, test } from "bun:test";
import {
  type AiTurnBlock,
  type AiWireEvent,
  applyWireEventToBlocks,
  compactionBlockId,
  isNewerWireEvent,
  messageBlockId,
  streamBlockId,
  toolBlockId,
} from "./protocol";

const wire = (partial: Record<string, unknown>): AiWireEvent => ({ v: 1, conversationId: "c", turnId: "t", ...partial }) as AiWireEvent;

describe("wire event ordering", () => {
  test("newer by attempt then seq", () => {
    expect(isNewerWireEvent({ attempt: 2, seq: 1 }, { attempt: 1, seq: 99 })).toBe(true);
    expect(isNewerWireEvent({ attempt: 1, seq: 5 }, { attempt: 1, seq: 4 })).toBe(true);
    expect(isNewerWireEvent({ attempt: 1, seq: 4 }, { attempt: 1, seq: 4 })).toBe(false);
    expect(isNewerWireEvent({ attempt: 1, seq: 3 }, { attempt: 2, seq: 0 })).toBe(false);
  });
});

describe("applyWireEventToBlocks", () => {
  test("block_set inserts then replaces by id", () => {
    let blocks: AiTurnBlock[] = [];
    blocks = applyWireEventToBlocks(blocks, wire({ attempt: 1, seq: 1, type: "block_set", block: { id: "a", kind: "text", text: "hi" } }));
    expect(blocks).toHaveLength(1);
    blocks = applyWireEventToBlocks(blocks, wire({ attempt: 1, seq: 2, type: "block_set", block: { id: "a", kind: "text", text: "hello" } }));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ id: "a", text: "hello" });
  });

  test("block_delta appends to text and creates when missing", () => {
    let blocks: AiTurnBlock[] = [{ id: "a", kind: "text", text: "he" }];
    blocks = applyWireEventToBlocks(blocks, wire({ attempt: 1, seq: 1, type: "block_delta", blockId: "a", blockKind: "text", delta: "llo" }));
    expect(blocks[0]).toMatchObject({ text: "hello" });
    blocks = applyWireEventToBlocks(blocks, wire({ attempt: 1, seq: 2, type: "block_delta", blockId: "b", blockKind: "thinking", delta: "hmm" }));
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ id: "b", kind: "thinking", text: "hmm" });
  });

  test("tool blocks update in place across status changes", () => {
    let blocks: AiTurnBlock[] = [];
    const id = toolBlockId("call-1");
    blocks = applyWireEventToBlocks(blocks, wire({ attempt: 1, seq: 1, type: "block_set", block: { id, kind: "tool", callId: "call-1", name: "web", status: "running" } }));
    blocks = applyWireEventToBlocks(blocks, wire({ attempt: 1, seq: 2, type: "block_set", block: { id, kind: "tool", callId: "call-1", name: "web", status: "completed", result: { ok: true } } }));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ status: "completed", result: { ok: true } });
  });

  test("turn_finished does not mutate blocks", () => {
    const blocks: AiTurnBlock[] = [{ id: "a", kind: "text", text: "x" }];
    const after = applyWireEventToBlocks(blocks, wire({ attempt: 1, seq: 9, type: "turn_finished", status: "completed", error: null }));
    expect(after).toEqual(blocks);
  });
});

describe("block id helpers", () => {
  test("stable and scoped ids", () => {
    expect(toolBlockId("c1")).toBe("tool-c1");
    expect(compactionBlockId).toBe("compaction");
    expect(streamBlockId(2, 3, "block-0")).toBe("a2-t3-block-0");
    expect(messageBlockId(4, 1)).toBe("m4-1");
  });
});
