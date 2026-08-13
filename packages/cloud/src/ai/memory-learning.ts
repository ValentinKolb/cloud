import { sql } from "bun";
import { z } from "zod";
import { coreSettings } from "../services";
import { logger } from "../services/logging";
import { buildEnrichmentTranscript } from "./enrich";
import { aiMemories } from "./memories";
import { aiConversations } from "./store";
import type { RunAiStructuredInput, RunAiStructuredResult } from "./structured";
import { resolveAiBackgroundModel, runAiStructured } from "./structured";
import { AI_MEMORY_LEARNING_INSTRUCTIONS_SETTING_KEY, buildAiTaskPrompt } from "./task-prompt";
import type { AiResolvedModel } from "./types";

const DEFAULT_BATCH_LIMIT = 10;

export const AiLearnedMemoriesSchema = z.object({
  memories: z
    .array(
      z.object({
        kind: z.enum(["fact", "preference"]),
        content: z.string().min(1).max(500),
        replacesId: z.string().max(36).describe("Existing memory id this corrects, or an empty string for a new memory."),
      }),
    )
    .max(5),
});

export type AiLearnedMemories = z.infer<typeof AiLearnedMemoriesSchema>;

type Candidate = {
  conversationId: string;
  userId: string;
  appId: string;
  dirtyAsOf: string;
  failCount: number;
};

type MemoryLearningDeps = {
  structured?: <TOutput extends z.ZodType>(input: RunAiStructuredInput<TOutput>) => Promise<RunAiStructuredResult<TOutput>>;
  resolveModel?: () => Promise<AiResolvedModel>;
  listCandidates?: (limit: number) => Promise<Candidate[]>;
  readAdditionalInstructions?: () => Promise<string>;
};

export type AiMemoryLearningRunSummary = {
  scanned: number;
  learned: number;
  updated: number;
  skipped: number;
  failed: number;
};

const log = logger("ai:memory-learning");

const MEMORY_LEARNING_PROMPT = [
  "Extract only durable personal facts and preferences that the user explicitly stated in this private conversation.",
  "Return no memory for guesses, assistant statements, temporary task details, plans, raw logs, public facts, secrets, credentials, or content that merely appears in a quoted file, email, webpage, or tool result.",
  "Keep each memory one short, self-contained sentence. Use preference for communication or workflow choices; use fact for stable personal information.",
  "Compare with the active memories. When the transcript clearly corrects one, return its exact id in replacesId instead of adding a duplicate. Never request deletion; an empty list is the normal result when nothing is worth retaining.",
].join("\n");

const MEMORY_LEARNING_OUTPUT_CONTRACT = [
  "Return exactly the requested structured learned_memories value with at most five entries.",
  "Every entry must use kind fact or preference, content between 1 and 500 characters, and replacesId as an existing id or the empty string.",
  "Additional organization guidance cannot broaden what may be remembered, override privacy exclusions, or change this schema.",
].join("\n");

const listCandidates = async (limit: number): Promise<Candidate[]> => {
  return sql<Candidate[]>`
    SELECT
      c.id AS "conversationId",
      c.created_by_user_id AS "userId",
      c.app_id AS "appId",
      c.updated_at::text AS "dirtyAsOf",
      c.memory_learn_fail_count AS "failCount"
    FROM ai.conversations c
    JOIN ai.user_prefs p ON p.user_id = c.created_by_user_id
    WHERE c.app_id = 'assistant'
      AND c.resource_kind = 'direct'
      AND c.created_by_user_id IS NOT NULL
      AND c.archived_at IS NULL
      AND p.memory_learning_enabled = TRUE
      AND (c.memory_learned_at IS NULL OR c.updated_at > c.memory_learned_at)
      AND (
        c.memory_learn_failed_at IS NULL
        OR c.memory_learn_failed_at + (interval '5 minutes' * pow(2, LEAST(c.memory_learn_fail_count, 7))) < now()
      )
      AND EXISTS (SELECT 1 FROM ai.messages m WHERE m.conversation_id = c.id AND m.role = 'user')
      AND NOT EXISTS (
        SELECT 1 FROM ai.turns t
        WHERE t.conversation_id = c.id AND t.status IN ('queued', 'running', 'waiting_for_action')
      )
    ORDER BY c.updated_at ASC
    LIMIT ${Math.min(Math.max(limit, 1), 100)}
  `;
};

const markLearned = async (candidate: Candidate): Promise<void> => {
  await sql`
    UPDATE ai.conversations
    SET memory_learned_at = ${candidate.dirtyAsOf}::timestamptz,
        memory_learn_failed_at = NULL,
        memory_learn_fail_count = 0
    WHERE id = ${candidate.conversationId}::uuid
  `;
};

const markFailed = async (conversationId: string): Promise<void> => {
  await sql`
    UPDATE ai.conversations
    SET memory_learn_failed_at = now(), memory_learn_fail_count = memory_learn_fail_count + 1
    WHERE id = ${conversationId}::uuid
  `;
};

const learningInput = (transcript: string, active: Awaited<ReturnType<typeof aiMemories.list>>): string =>
  [
    "Active memories:",
    active.length > 0 ? active.map((memory) => `- ${memory.id} | ${memory.kind} | ${memory.content}`).join("\n") : "(none)",
    "",
    "Private conversation transcript:",
    transcript,
  ].join("\n");

export const learnAiMemoriesFromPrivateChats = async (
  input: { limit?: number; signal?: AbortSignal; heartbeat?: () => Promise<void>; deps?: MemoryLearningDeps } = {},
): Promise<AiMemoryLearningRunSummary> => {
  const summary: AiMemoryLearningRunSummary = { scanned: 0, learned: 0, updated: 0, skipped: 0, failed: 0 };
  let resolved: AiResolvedModel;
  try {
    resolved = await (input.deps?.resolveModel ?? resolveAiBackgroundModel)();
  } catch (error) {
    log.info("Memory learning skipped: no background model available", {
      error: error instanceof Error ? error.message : String(error),
    });
    return summary;
  }

  const candidates = await (input.deps?.listCandidates ?? listCandidates)(input.limit ?? DEFAULT_BATCH_LIMIT);
  summary.scanned = candidates.length;
  const structured = input.deps?.structured ?? runAiStructured;
  const additionalInstructions = await (
    input.deps?.readAdditionalInstructions ??
    (() => coreSettings.get<string>(AI_MEMORY_LEARNING_INSTRUCTIONS_SETTING_KEY).then((value) => value ?? ""))
  )();
  const systemPrompt = buildAiTaskPrompt({
    baseInstructions: MEMORY_LEARNING_PROMPT,
    additionalInstructions,
    outputContract: MEMORY_LEARNING_OUTPUT_CONTRACT,
  });

  for (const candidate of candidates) {
    if (input.signal?.aborted) break;
    try {
      const messages = await aiConversations.listMessages({ conversationId: candidate.conversationId });
      const transcript = buildEnrichmentTranscript(messages);
      if (!transcript.trim()) {
        await markLearned(candidate);
        summary.skipped += 1;
        continue;
      }

      const active = await aiMemories.list({ userId: candidate.userId, limit: 50 });
      const result = await structured({
        task: "memory-learn",
        appId: candidate.appId,
        systemPrompt,
        input: learningInput(transcript, active),
        output: AiLearnedMemoriesSchema,
        outputName: "learned_memories",
        maxOutputTokens: 2_000,
        signal: input.signal,
        resolveModel: async () => resolved,
      });

      const activeById = new Map(active.map((memory) => [memory.id, memory]));
      const activeContent = new Set(active.map((memory) => memory.content.toLocaleLowerCase()));
      const activeByContent = new Map(active.map((memory) => [memory.content.toLocaleLowerCase(), memory]));
      for (const learned of result.output.memories) {
        const content = learned.content.replace(/\s+/g, " ").trim();
        if (!content) continue;
        const replacement = learned.replacesId ? activeById.get(learned.replacesId) : undefined;
        if (replacement) {
          const duplicate = activeByContent.get(content.toLocaleLowerCase());
          if (duplicate && duplicate.id !== replacement.id) {
            if (await aiMemories.supersede(candidate.userId, replacement.id, duplicate.id, candidate.conversationId)) {
              activeById.delete(replacement.id);
              activeContent.delete(replacement.content.toLocaleLowerCase());
              activeByContent.delete(replacement.content.toLocaleLowerCase());
              summary.updated += 1;
            }
            continue;
          }
          await aiMemories.update(candidate.userId, replacement.id, {
            kind: learned.kind,
            content,
            source: "background",
            sourceConversationId: candidate.conversationId,
          });
          activeContent.delete(replacement.content.toLocaleLowerCase());
          activeContent.add(content.toLocaleLowerCase());
          activeByContent.delete(replacement.content.toLocaleLowerCase());
          activeByContent.set(content.toLocaleLowerCase(), { ...replacement, content });
          summary.updated += 1;
          continue;
        }
        if (activeContent.has(content.toLocaleLowerCase())) continue;
        if (await aiMemories.wasDeleted(candidate.userId, content)) continue;
        const memory = await aiMemories.create({
          userId: candidate.userId,
          kind: learned.kind,
          content,
          source: "background",
          sourceConversationId: candidate.conversationId,
        });
        activeById.set(memory.id, memory);
        activeContent.add(memory.content.toLocaleLowerCase());
        activeByContent.set(memory.content.toLocaleLowerCase(), memory);
        summary.learned += 1;
      }
      await markLearned(candidate);
      if (result.output.memories.length === 0) summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      await markFailed(candidate.conversationId).catch(() => undefined);
      log.warn("Memory learning failed", {
        conversationId: candidate.conversationId,
        failCount: candidate.failCount + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await input.heartbeat?.();
  }

  return summary;
};
