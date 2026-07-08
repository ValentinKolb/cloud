import type { CompactResult, Message } from "@valentinkolb/nessi";
import type { AiConversation, AiFrontendToolMode, AiStoredMessage, AiTurnStatus } from "./types";

/**
 * Cloud AI wire protocol.
 *
 * The versioned, Cloud-owned contract between the turn executor, the live
 * fanout topic, the SSE stream, and the client projection. Nessi events are
 * translated into this protocol at the runtime boundary and never leave it.
 *
 * Ordering: every event carries (attempt, seq). The lease owner of a turn is
 * the single writer and allocates seq in-process; attempt increments on every
 * claim, so events of a re-claimed turn always supersede older ones. Each
 * attempt starts with `turn_started` followed by a full `block_set` prefix,
 * which makes attempt transitions self-healing for every subscriber.
 */

export const AI_WIRE_VERSION = 1;

export type AiToolBlockStatus = "running" | "awaiting_approval" | "awaiting_client" | "completed" | "failed" | "rejected";

export type AiTurnBlock =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "thinking"; text: string }
  | {
      id: string;
      kind: "tool";
      callId: string;
      name: string;
      args?: unknown;
      status: AiToolBlockStatus;
      result?: unknown;
      isError?: boolean;
      /** Present while status is awaiting_approval. */
      approval?: { message?: string; allowAlways: boolean };
      /** Present for frontend tools. */
      frontendMode?: AiFrontendToolMode;
    }
  | { id: string; kind: "compaction"; status: "running" | "completed" | "skipped" | "failed"; result?: CompactResult };

type AiWireEventBase = {
  v: typeof AI_WIRE_VERSION;
  conversationId: string;
  turnId: string;
  attempt: number;
  seq: number;
};

export type AiTurnFinishedStatus = "completed" | "failed" | "aborted";

export type AiWireEvent =
  | (AiWireEventBase & { type: "turn_started"; modelProfileId: string; providerModel: string })
  | (AiWireEventBase & { type: "block_set"; block: AiTurnBlock })
  | (AiWireEventBase & { type: "block_delta"; blockId: string; blockKind: "text" | "thinking"; delta: string })
  | (AiWireEventBase & {
      type: "turn_finished";
      status: AiTurnFinishedStatus;
      error: string | null;
      /** Messages persisted by this turn. Attached by the SSE layer; absent on the raw topic. */
      messages?: AiStoredMessage[];
    });

/** Snapshot of the active turn, sent in `state` events and kept in ai.turns.live_blocks. */
export type AiTurnSnapshot = {
  turnId: string;
  attempt: number;
  status: AiTurnStatus;
  /** Last wire seq reflected in `blocks` (attempt-scoped). */
  seq: number;
  blocks: AiTurnBlock[];
  modelProfileId: string | null;
  createdAt: string;
};

/** Full projection seed sent as the first SSE event on every (re)connect. */
export type AiStreamState = {
  type: "state";
  conversation: AiConversation;
  messages: AiStoredMessage[];
  activeTurn: AiTurnSnapshot | null;
};

export type AiStreamSseEvent = AiStreamState | AiWireEvent;

export const isNewerWireEvent = (event: { attempt: number; seq: number }, current: { attempt: number; seq: number }): boolean =>
  event.attempt > current.attempt || (event.attempt === current.attempt && event.seq > current.seq);

/**
 * Apply a wire event to a block list. Pure and total — unknown ids create
 * blocks, unknown event types are ignored. Shared by the executor (authoritative
 * state for snapshots) and the client projection so both converge on identical
 * block lists for identical event streams.
 */
export const applyWireEventToBlocks = (blocks: AiTurnBlock[], event: AiWireEvent): AiTurnBlock[] => {
  if (event.type === "block_set") {
    const index = blocks.findIndex((block) => block.id === event.block.id);
    if (index < 0) return [...blocks, event.block];
    return [...blocks.slice(0, index), event.block, ...blocks.slice(index + 1)];
  }

  if (event.type === "block_delta") {
    const index = blocks.findIndex((block) => block.id === event.blockId);
    if (index < 0) {
      return [...blocks, { id: event.blockId, kind: event.blockKind, text: event.delta }];
    }
    const existing = blocks[index]!;
    if (existing.kind !== "text" && existing.kind !== "thinking") return blocks;
    return [...blocks.slice(0, index), { ...existing, text: existing.text + event.delta }, ...blocks.slice(index + 1)];
  }

  return blocks;
};

/**
 * Convert persisted loop messages into the block model. Shared by the executor
 * (baseline rebuild on claim) and the client (rendering finished turns), so a
 * live turn and its persisted form render through exactly the same block list.
 */
export const buildBlocksFromMessages = (messages: { seq: number; message: Message }[]): AiTurnBlock[] => {
  const blocks: AiTurnBlock[] = [];
  const toolIndex = new Map<string, number>();

  for (const { seq, message } of messages) {
    if (message.role === "assistant") {
      message.content.forEach((block, index) => {
        if (block.type === "text") {
          if (block.text.trim().length > 0) blocks.push({ id: messageBlockId(seq, index), kind: "text", text: block.text });
        } else if (block.type === "thinking") {
          blocks.push({ id: messageBlockId(seq, index), kind: "thinking", text: block.thinking });
        } else if (block.type === "tool_call") {
          toolIndex.set(block.id, blocks.length);
          blocks.push({ id: toolBlockId(block.id), kind: "tool", callId: block.id, name: block.name, args: block.args, status: "running" });
        }
      });
    } else if (message.role === "tool_result") {
      const at = toolIndex.get(message.callId);
      const existing = at !== undefined ? blocks[at] : undefined;
      if (existing?.kind === "tool") {
        blocks[at!] = { ...existing, status: message.isError ? "failed" : "completed", result: message.result, isError: message.isError };
      }
    }
  }

  return blocks;
};

/**
 * Whether a block renders visible content. Whitespace-only text blocks (think-tag
 * separators the model emits between rounds) must not occupy layout space — the
 * live view and the persisted view share this rule so they space identically.
 */
export const isRenderableTurnBlock = (block: AiTurnBlock): boolean =>
  !(block.kind === "text" && block.text.trim().length === 0);

/** Stable block id for a tool call — keyed by callId so tool blocks survive attempt bumps. */
export const toolBlockId = (callId: string): string => `tool-${callId}`;

/**
 * Block id for streamed text/thinking content. nessi block ids are only unique
 * within one provider turn, so they are scoped by (attempt, turnIndex).
 */
export const streamBlockId = (attempt: number, turnIndex: number, nessiBlockId: string): string => `a${attempt}-t${turnIndex}-${nessiBlockId}`;

/** Block id for text/thinking blocks rebuilt from a persisted message. */
export const messageBlockId = (messageSeq: number, blockIndex: number): string => `m${messageSeq}-${blockIndex}`;

export const compactionBlockId = "compaction";
