import { describe, expect, test } from "bun:test";
import type { OutboundEvent } from "@valentinkolb/nessi";
import { __aiExecutorTest } from "./executor";
import { streamBlockId, toolBlockId } from "./protocol";

const { createEventMapper } = __aiExecutorTest;

const turn = { agentId: "cloud", loopId: "turn-1", turnId: "turn-1:turn:0", turnIndex: 0 };

describe("nessi block event mapping", () => {
  test("text blocks map to attempt+turn scoped ids across start, delta, end", () => {
    const mapper = createEventMapper(2, []);
    const id = streamBlockId(2, 0, "block-0");

    const start = mapper.translate({ ...turn, type: "block_start", blockId: "block-0", index: 0, kind: "text" } as OutboundEvent);
    expect(start).toEqual([{ type: "block_set", block: { id, kind: "text", text: "" } }]);

    const delta = mapper.translate({ ...turn, type: "block_delta", blockId: "block-0", delta: "Hello" } as OutboundEvent);
    expect(delta).toEqual([{ type: "block_delta", blockId: id, blockKind: "text", delta: "Hello" }]);

    const end = mapper.translate({
      ...turn,
      type: "block_end",
      blockId: "block-0",
      index: 0,
      block: { type: "text", text: "Hello world" },
    } as OutboundEvent);
    expect(end).toEqual([{ type: "block_set", block: { id, kind: "text", text: "Hello world" } }]);
  });

  test("same nessi blockId in different turns and attempts never collides", () => {
    expect(streamBlockId(1, 0, "block-0")).not.toBe(streamBlockId(1, 1, "block-0"));
    expect(streamBlockId(1, 0, "block-0")).not.toBe(streamBlockId(2, 0, "block-0"));
  });

  test("tool_call blocks route to callId-keyed tool blocks and their arg deltas are hidden", () => {
    const mapper = createEventMapper(1, []);

    const start = mapper.translate({
      ...turn,
      type: "block_start",
      blockId: "block-1",
      index: 1,
      kind: "tool_call",
      callId: "call-1",
      name: "web_search",
    } as OutboundEvent);
    expect(start).toEqual([
      { type: "block_set", block: { id: toolBlockId("call-1"), kind: "tool", callId: "call-1", name: "web_search", args: undefined, status: "running", result: undefined, isError: undefined, approval: undefined, frontendMode: undefined } },
    ]);

    // Raw args JSON streams as deltas on the tool block — never rendered.
    const argsDelta = mapper.translate({ ...turn, type: "block_delta", blockId: "block-1", delta: '{"query":' } as OutboundEvent);
    expect(argsDelta).toEqual([]);

    const end = mapper.translate({
      ...turn,
      type: "block_end",
      blockId: "block-1",
      index: 1,
      block: { type: "tool_call", id: "call-1", name: "web_search", args: { query: "hi" } },
    } as OutboundEvent);
    expect(end).toHaveLength(1);
    expect(end[0]).toMatchObject({ type: "block_set", block: { id: toolBlockId("call-1"), kind: "tool", args: { query: "hi" }, status: "running" } });

    const done = mapper.translate({
      ...turn,
      type: "tool_execution_end",
      callId: "call-1",
      name: "web_search",
      result: { results: [] },
      isError: false,
    } as OutboundEvent);
    expect(done[0]).toMatchObject({ type: "block_set", block: { status: "completed", result: { results: [] } } });
  });

  test("tool_action_request marks the tool block awaiting with approval metadata", () => {
    const mapper = createEventMapper(1, []);
    const ops = mapper.translate({
      ...turn,
      type: "tool_action_request",
      kind: "approval",
      callId: "call-9",
      name: "danger",
      args: { a: 1 },
      message: "Sure?",
    } as OutboundEvent);
    expect(ops[0]).toMatchObject({
      type: "block_set",
      block: { id: toolBlockId("call-9"), status: "awaiting_approval", approval: { message: "Sure?" } },
    });
  });

  test("client tool action requests carry the tool's real frontend mode", () => {
    const mapper = createEventMapper(1, []);
    mapper.setFrontendModes(new Map([["survey", "client_interaction"]]));
    const ops = mapper.translate({
      ...turn,
      type: "tool_action_request",
      kind: "client_tool",
      callId: "call-7",
      name: "survey",
      args: { title: "Feedback" },
      message: "",
    } as OutboundEvent);
    // "client" here would let the frontend auto-answer the survey with a fake
    // result before the user sees it (the "AI action request not found" bug).
    expect(ops[0]).toMatchObject({
      type: "block_set",
      block: { id: toolBlockId("call-7"), status: "awaiting_client", frontendMode: "client_interaction" },
    });

    // Unknown client tools fall back to plain "client".
    const fallback = mapper.translate({
      ...turn,
      type: "tool_action_request",
      kind: "client_tool",
      callId: "call-8",
      name: "unknown-tool",
      args: {},
      message: "",
    } as OutboundEvent);
    expect(fallback[0]).toMatchObject({ type: "block_set", block: { frontendMode: "client" } });
  });

  test("issues with a callId mark an unfinished tool block failed", () => {
    const mapper = createEventMapper(1, []);
    mapper.translate({ ...turn, type: "tool_execution_start", callId: "call-2", name: "web_extract", args: {} } as OutboundEvent);
    const ops = mapper.translate({
      ...turn,
      type: "issue",
      issue: { kind: "timeout", scope: "tool", message: "Tool timed out", retryable: false, callId: "call-2", name: "web_extract" },
    } as OutboundEvent);
    expect(ops[0]).toMatchObject({ type: "block_set", block: { id: toolBlockId("call-2"), status: "failed", isError: true } });

    // Issues for completed tools or without callId are ignored.
    const ignored = mapper.translate({
      ...turn,
      type: "issue",
      issue: { kind: "runtime_error", message: "boom", retryable: false },
    } as OutboundEvent);
    expect(ignored).toEqual([]);
  });

  test("seeded tool blocks keep their metadata across attempts", () => {
    const mapper = createEventMapper(3, [
      { id: toolBlockId("call-1"), kind: "tool", callId: "call-1", name: "danger", args: { a: 1 }, status: "awaiting_approval", approval: { allowAlways: true } },
    ]);
    const ops = mapper.translate({
      ...turn,
      type: "tool_execution_end",
      callId: "call-1",
      name: "danger",
      result: { done: true },
    } as OutboundEvent);
    expect(ops[0]).toMatchObject({ type: "block_set", block: { args: { a: 1 }, status: "completed", approval: undefined } });
  });

  test("loop lifecycle and usage events map to nothing", () => {
    const mapper = createEventMapper(1, []);
    expect(mapper.translate({ type: "loop_start", agentId: "cloud", loopId: "turn-1" } as OutboundEvent)).toEqual([]);
    expect(mapper.translate({ ...turn, type: "turn_start" } as OutboundEvent)).toEqual([]);
    expect(mapper.translate({ ...turn, type: "usage", usage: { input: 1, output: 1, total: 2 } } as OutboundEvent)).toEqual([]);
  });
});
