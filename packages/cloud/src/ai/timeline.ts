import type { Message } from "@valentinkolb/nessi";
import type { AiTurnBlock } from "./protocol";
import { buildBlocksFromMessages } from "./protocol";
import type { AiStoredMessage } from "./types";

export type AiAssistantTimelineItem = {
  type: "assistant";
  id: string;
  loopId: string | null;
  entries: AiStoredMessage[];
  blocks: AiTurnBlock[];
  /** The entry whose message-actions row (copy/retry/fork) is shown. */
  actionEntry: AiStoredMessage | null;
};

export type AiMessageTimelineItem =
  | { type: "user"; id: string; entry: AiStoredMessage }
  | { type: "summary"; id: string; entry: AiStoredMessage }
  | AiAssistantTimelineItem;

export const assistantVisibleTextFromMessage = (message: Message): string => {
  if (message.role !== "assistant") return "";
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
};

export const copyTextFromAssistantEntries = (entries: AiStoredMessage[]): string =>
  entries
    .map((entry) => assistantVisibleTextFromMessage(entry.message))
    .filter(Boolean)
    .join("\n\n")
    .trim();

const isAssistantPart = (entry: AiStoredMessage): boolean =>
  entry.kind === "message" && (entry.message.role === "assistant" || entry.message.role === "tool_result");

const sameLoop = (entry: AiStoredMessage, loopId: string | null): boolean => (loopId ? entry.loopId === loopId : entry.loopId === null);

const assistantActionEntry = (entries: AiStoredMessage[]): AiStoredMessage | null => {
  const assistantEntries = entries.filter((entry) => entry.kind === "message" && entry.message.role === "assistant");
  for (let i = assistantEntries.length - 1; i >= 0; i--) {
    const entry = assistantEntries[i]!;
    if (entry.loopAggregate || assistantVisibleTextFromMessage(entry.message)) return entry;
  }
  return assistantEntries.at(-1) ?? null;
};

/**
 * Group stored messages into render items: user bubbles, summary rows, and
 * assistant response groups (one per loop). Assistant groups carry a unified
 * AiTurnBlock list, identical in shape to a live turn's blocks.
 */
export const buildAiMessageTimeline = (messages: AiStoredMessage[]): AiMessageTimelineItem[] => {
  const items: AiMessageTimelineItem[] = [];

  for (let index = 0; index < messages.length; ) {
    const entry = messages[index]!;

    if (entry.kind === "summary") {
      items.push({ type: "summary", id: entry.id, entry });
      index += 1;
      continue;
    }
    if (entry.message.role === "user") {
      items.push({ type: "user", id: entry.id, entry });
      index += 1;
      continue;
    }

    // Assistant response group: this assistant message plus following same-loop parts.
    const loopId = entry.loopId;
    const entries = [entry];
    index += 1;
    while (index < messages.length && isAssistantPart(messages[index]!) && sameLoop(messages[index]!, loopId)) {
      entries.push(messages[index]!);
      index += 1;
    }

    items.push({
      type: "assistant",
      id: loopId ? `assistant-loop-${loopId}` : `assistant-legacy-${entry.id}`,
      loopId,
      entries,
      blocks: buildBlocksFromMessages(entries.map((stored) => ({ seq: stored.seq, message: stored.message }))),
      actionEntry: assistantActionEntry(entries),
    });
  }

  return items;
};
