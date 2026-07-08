import type { AiStreamSseEvent, AiTurnBlock, AiTurnSnapshot, AiWireEvent } from "../protocol";
import { applyWireEventToBlocks, isNewerWireEvent } from "../protocol";
import type { AiConversation, AiStoredMessage } from "../types";

export type AiActiveTurn = {
  turnId: string;
  attempt: number;
  seq: number;
  status: "running" | "waiting_for_action";
  blocks: AiTurnBlock[];
  modelProfileId: string | null;
};

export type AiChatProjection = {
  conversation: AiConversation | null;
  messages: AiStoredMessage[];
  activeTurn: AiActiveTurn | null;
};

export const emptyProjection = (conversation: AiConversation | null = null): AiChatProjection => ({
  conversation,
  messages: [],
  activeTurn: null,
});

const mergeMessages = (existing: AiStoredMessage[], incoming: AiStoredMessage[]): AiStoredMessage[] => {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
};

/** A turn is "waiting" when any of its tool blocks is awaiting a user action. */
const deriveStatus = (blocks: AiTurnBlock[]): "running" | "waiting_for_action" =>
  blocks.some((block) => block.kind === "tool" && (block.status === "awaiting_approval" || block.status === "awaiting_client"))
    ? "waiting_for_action"
    : "running";

/** Convert a server turn snapshot into a live active-turn (queued turns count as running). */
export const activeTurnFromSnapshot = (snapshot: AiTurnSnapshot | null): AiActiveTurn | null => {
  if (!snapshot) return null;
  if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "aborted") return null;
  return {
    turnId: snapshot.turnId,
    attempt: snapshot.attempt,
    seq: snapshot.seq,
    status: snapshot.status === "waiting_for_action" ? "waiting_for_action" : "running",
    blocks: snapshot.blocks,
    modelProfileId: snapshot.modelProfileId,
  };
};

/**
 * Fold one stream event into the projection. Pure and total: the client and any
 * test converge on the same state for the same ordered event sequence.
 *
 * Rules:
 * - `state` replaces everything (reconnect baseline).
 * - `turn_started` resets the active turn's live blocks (new turn or new attempt);
 *   stale attempts are ignored.
 * - block events apply only when strictly newer than the active turn's cursor.
 * - `turn_finished` folds the turn's persisted messages in and clears the active turn.
 */
export const reduceProjection = (state: AiChatProjection, event: AiStreamSseEvent): AiChatProjection => {
  if (event.type === "state") {
    return {
      conversation: event.conversation,
      messages: event.messages,
      activeTurn: activeTurnFromSnapshot(event.activeTurn),
    };
  }

  return reduceWireEvent(state, event);
};

export const reduceWireEvent = (state: AiChatProjection, event: AiWireEvent): AiChatProjection => {
  const active = state.activeTurn;

  if (event.type === "turn_started") {
    if (active && active.turnId === event.turnId && event.attempt < active.attempt) return state;
    return {
      ...state,
      activeTurn: { turnId: event.turnId, attempt: event.attempt, seq: event.seq, status: "running", blocks: [], modelProfileId: event.modelProfileId },
    };
  }

  if (event.type === "turn_finished") {
    if (!active || active.turnId !== event.turnId) return state;
    return { ...state, messages: mergeMessages(state.messages, event.messages ?? []), activeTurn: null };
  }

  // block_set / block_delta
  if (!active || active.turnId !== event.turnId) return state;
  if (!isNewerWireEvent(event, active)) return state;
  const blocks = applyWireEventToBlocks(active.blocks, event);
  return { ...state, activeTurn: { ...active, attempt: event.attempt, seq: event.seq, blocks, status: deriveStatus(blocks) } };
};

/** Assistant/tool messages of the active turn are represented by live blocks; hide them. */
export const visibleMessages = (state: AiChatProjection): AiStoredMessage[] => {
  const activeTurnId = state.activeTurn?.turnId;
  if (!activeTurnId) return state.messages;
  return state.messages.filter((message) => message.loopId !== activeTurnId || message.message.role === "user");
};
