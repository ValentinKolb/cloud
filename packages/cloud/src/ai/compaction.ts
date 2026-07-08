import type { CompactFn, Message, StoreEntry } from "@valentinkolb/nessi";
import { truncateMiddle } from "@valentinkolb/nessi";
import { aiConversationStore } from "./store";

const DEFAULT_COMPACTION_PROMPT = [
  "Summarize the chat context for a future assistant turn.",
  "Preserve user goals, preferences, constraints, decisions, important facts, tool results, pending tasks, and unresolved questions.",
  "Do not invent details. Keep the summary compact but complete enough that the next assistant can continue correctly.",
].join("\n");

const COMPACTION_FILL_RATIO = 0.75;
const COMPACTION_KEEP_RECENT_LOOPS = 2;
const COMPACTION_MAX_SOURCE_CHARS = 24_000;
const COMPACTION_MAX_TOOL_RESULT_CHARS = 1_200;

const textFromAssistant = (message: Extract<Message, { role: "assistant" }>): string =>
  message.content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "thinking") return `[thinking]\n${truncateMiddle(block.thinking, 1_000)}`;
      return `[tool_call ${block.name} ${block.id}]\n${truncateMiddle(JSON.stringify(block.args), 1_000)}`;
    })
    .filter(Boolean)
    .join("\n\n");

export const assistantSummaryText = textFromAssistant;

const messageToCompactionText = (entry: StoreEntry): string => {
  const { message } = entry;
  if (message.role === "user") {
    const text = message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part.type === "text") return part.text;
        return `[file ${part.mediaType}]`;
      })
      .join("\n");
    return `#${entry.seq} user\n${truncateMiddle(text, 4_000)}`;
  }
  if (message.role === "assistant") return `#${entry.seq} assistant\n${truncateMiddle(textFromAssistant(message), 4_000)}`;
  return `#${entry.seq} tool_result ${message.name}\n${truncateMiddle(JSON.stringify(message.result), COMPACTION_MAX_TOOL_RESULT_CHARS)}`;
};

const countConversationLoops = (entries: StoreEntry[]): number =>
  entries.reduce((count, entry) => count + (entry.kind === "message" && entry.message.role === "user" ? 1 : 0), 0);

const keepLoopsForFillRatio = (fillRatio: number | undefined, totalLoops: number): number => {
  if (typeof fillRatio !== "number") return COMPACTION_KEEP_RECENT_LOOPS;
  const target = Math.round(totalLoops * Math.max(0.2, 1 - fillRatio));
  return Math.max(COMPACTION_KEEP_RECENT_LOOPS, target);
};

const findLoopSplitIndex = (entries: StoreEntry[], keepLoops: number): number => {
  let loopsSeen = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === "message" && entry.message.role === "user") {
      loopsSeen += 1;
      if (loopsSeen === keepLoops) return index > 0 ? index : -1;
    }
  }
  return -1;
};

const buildCompactionPrompt = (prompt: string, source: string) => {
  const template = (prompt.trim() || DEFAULT_COMPACTION_PROMPT).trim();
  if (template.includes("{{conversation}}")) {
    return {
      systemPrompt: template.replaceAll("{{conversation}}", source),
      userText: "Please summarize the conversation above.",
    };
  }
  return {
    systemPrompt: template,
    userText: `Summarize these chat entries for future context:\n\n${source}`,
  };
};

export const createCloudCompactFn = (input: {
  conversationId: string;
  modelProfileId: string;
  prompt: string;
  maxOutputTokens?: number;
  signal: AbortSignal;
}): CompactFn => {
  return (ctx) => {
    if (!ctx.force && (typeof ctx.fillRatio !== "number" || ctx.fillRatio < COMPACTION_FILL_RATIO)) return null;

    const totalLoops = countConversationLoops(ctx.entries);
    if (totalLoops <= COMPACTION_KEEP_RECENT_LOOPS) return null;

    const splitIndex = findLoopSplitIndex(ctx.entries, keepLoopsForFillRatio(ctx.fillRatio, totalLoops));
    if (splitIndex < 1) return null;

    const sourceEntries = ctx.entries.slice(0, splitIndex);
    if (sourceEntries.length < 2) return null;
    const checkpoint = sourceEntries[sourceEntries.length - 1];
    if (!checkpoint || checkpoint.seq <= 0) return null;

    return (async () => {
      const source = truncateMiddle(sourceEntries.map(messageToCompactionText).join("\n\n"), COMPACTION_MAX_SOURCE_CHARS);
      const prompt = buildCompactionPrompt(input.prompt, source);
      const result = await ctx.provider.complete({
        systemPrompt: prompt.systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: prompt.userText }] }],
        tools: [],
        maxOutputTokens: input.maxOutputTokens,
        signal: input.signal,
        disableReasoning: true,
      });
      const summaryText = textFromAssistant(result.message).trim();
      if (!summaryText) return;

      await aiConversationStore.compactMessages({
        conversationId: input.conversationId,
        checkpointSeq: checkpoint.seq,
        modelProfileId: input.modelProfileId,
        summary: {
          role: "assistant",
          content: [{ type: "text", text: `Conversation summary:\n${summaryText}` }],
          model: ctx.provider.model,
          usage: result.usage,
          stopReason: result.finishReason,
        },
      });
    })().catch((error) => {
      if (ctx.force) throw error;
      console.warn("Skipped optional AI context compaction", error);
    });
  };
};

export const __compactionTest = { countConversationLoops, findLoopSplitIndex, keepLoopsForFillRatio };
