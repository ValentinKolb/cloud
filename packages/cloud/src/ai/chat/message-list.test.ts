import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AiTurnBlock, splitActiveTurnBlocks } from "../protocol";

test("distinguishes a pending response from model reasoning", () => {
  const messageListSource = readFileSync(resolve(import.meta.dir, "message-list.tsx"), "utf8");
  const blocksSource = readFileSync(resolve(import.meta.dir, "blocks.tsx"), "utf8");

  expect(messageListSource).toContain('const AI_PENDING_TURN_LABEL = "Generating response"');
  expect(blocksSource).toContain('label: "Thinking"');
  expect(blocksSource).toContain('label: "Show reasoning"');
});

describe("active turn message segmentation", () => {
  test("keeps the optimistic steer bubble between pre-steer work and the applied marker", () => {
    const blocks: AiTurnBlock[] = [
      { id: "text-1", kind: "text", text: "Working" },
      { id: "steer-message-1", kind: "steer_message", steerId: "1", text: "Change course", status: "pending" },
      { id: "tool-1", kind: "tool", callId: "call-1", name: "bash", status: "completed", result: "ok" },
      { id: "steer-applied-1", kind: "steer_applied", steerId: "1" },
      { id: "text-2", kind: "text", text: "Revised" },
    ];

    const segments = splitActiveTurnBlocks(blocks);
    expect(segments.map((segment) => segment.type)).toEqual(["assistant", "steer", "assistant"]);
    expect(segments[0]).toMatchObject({ type: "assistant", blocks: [{ id: "text-1" }] });
    expect(segments[1]).toMatchObject({ type: "steer", block: { text: "Change course", status: "pending" } });
    expect(segments[2]).toMatchObject({
      type: "assistant",
      blocks: [{ id: "tool-1" }, { id: "steer-applied-1" }, { id: "text-2" }],
    });
  });
});
