import type { Message } from "@valentinkolb/nessi";
import type { AiStoredMessage } from "./types";

type AssistantMessage = Extract<Message, { role: "assistant" }>;

export type AssistantVisibleBlock = Extract<AssistantMessage["content"][number], { type: "thinking" | "text" | "tool_call" }>;

export type AiAssistantResponseTimelineItem = {
  type: "assistant_response";
  id: string;
  loopId: string | null;
  entries: AiStoredMessage[];
  actionEntry: AiStoredMessage | null;
};

export type AiMessageTimelineItem = { type: "entry"; id: string; entry: AiStoredMessage } | AiAssistantResponseTimelineItem;

export const assistantBlocks = (message: Message): AssistantMessage["content"] => (message.role === "assistant" ? message.content : []);

const isAssistantVisibleBlock = (block: AssistantMessage["content"][number]): block is AssistantVisibleBlock =>
  block.type === "thinking" || block.type === "text" || block.type === "tool_call";

export const assistantVisibleBlocks = (message: Message): AssistantVisibleBlock[] =>
  assistantBlocks(message).filter(isAssistantVisibleBlock);

export const assistantDisplayBlocks = (message: Message): AssistantVisibleBlock[] => {
  const blocks = assistantVisibleBlocks(message);
  const thinkingBlocks = blocks.filter((block) => block.type === "thinking");
  if (thinkingBlocks.length === 0) return blocks;
  return [...thinkingBlocks, ...blocks.filter((block) => block.type !== "thinking")];
};

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

const isAssistantResponseStart = (entry: AiStoredMessage): boolean => entry.kind === "message" && entry.message.role === "assistant";

const isAssistantResponsePart = (entry: AiStoredMessage): boolean =>
  entry.kind === "message" && (entry.message.role === "assistant" || entry.message.role === "tool_result");

const canAppendToAssistantResponse = (entry: AiStoredMessage, loopId: string | null): boolean => {
  if (!isAssistantResponsePart(entry)) return false;
  if (loopId) return entry.loopId === loopId;
  return entry.loopId === null;
};

const assistantActionEntry = (entries: AiStoredMessage[]): AiStoredMessage | null => {
  const assistantEntries = entries.filter((entry) => entry.kind === "message" && entry.message.role === "assistant");
  for (let i = assistantEntries.length - 1; i >= 0; i--) {
    const entry = assistantEntries[i]!;
    if (entry.loopAggregate || assistantVisibleTextFromMessage(entry.message)) return entry;
  }
  return assistantEntries.at(-1) ?? null;
};

export const buildAiMessageTimeline = (messages: AiStoredMessage[]): AiMessageTimelineItem[] => {
  const items: AiMessageTimelineItem[] = [];

  for (let index = 0; index < messages.length; ) {
    const entry = messages[index]!;
    if (!isAssistantResponseStart(entry)) {
      items.push({ type: "entry", id: entry.id, entry });
      index += 1;
      continue;
    }

    const loopId = entry.loopId;
    const entries = [entry];
    index += 1;

    while (index < messages.length && canAppendToAssistantResponse(messages[index]!, loopId)) {
      entries.push(messages[index]!);
      index += 1;
    }

    items.push({
      type: "assistant_response",
      id: loopId ? `assistant-loop-${loopId}` : `assistant-legacy-${entry.id}`,
      loopId,
      entries,
      actionEntry: assistantActionEntry(entries),
    });
  }

  return items;
};
