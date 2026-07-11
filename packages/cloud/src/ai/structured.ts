import type { LoopAggregate, StructuredMeta, Usage } from "@valentinkolb/nessi";
import { nessi, StructuredOutputError } from "@valentinkolb/nessi";
import type { z } from "zod";
import { coreSettings } from "../services";
import type { TraceContext } from "../services/logging";
import { trace } from "../services/logging";
import { resolveAiModel } from "./settings";
import type { AiResolvedModel } from "./types";

export const AI_BACKGROUND_MODEL_SETTING_KEY = "ai.background_model_id";

/**
 * Resolve the model for background inference: explicit request →
 * `ai.background_model_id` setting → platform default. Throws when AI is
 * disabled or the model is unavailable — callers skip their work then.
 */
export const resolveAiBackgroundModel = async (requestedModelId?: string): Promise<AiResolvedModel> => {
  const backgroundModelId = String((await coreSettings.get<string>(AI_BACKGROUND_MODEL_SETTING_KEY)) ?? "").trim();
  return resolveAiModel({ kind: "selectable" }, requestedModelId?.trim() || backgroundModelId || undefined);
};

export type RunAiStructuredInput<TOutput extends z.ZodType> = {
  /** Short machine name for tracing, e.g. "chat-enrich". */
  task: string;
  input: string;
  output: TOutput;
  outputName?: string;
  systemPrompt?: string;
  requestedModelId?: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /** Parent trace span when the caller already runs inside one (e.g. a sync job). */
  traceParent?: TraceContext;
  appId?: string;
  /** Model resolution seam — tests inject a fake so they never touch shared settings. */
  resolveModel?: (requestedModelId?: string) => Promise<AiResolvedModel>;
};

export type RunAiStructuredResult<TOutput extends z.ZodType> = {
  output: z.infer<TOutput>;
  modelProfileId: string;
  usage?: Usage;
  structuredMeta: StructuredMeta;
};

/**
 * One schema-valid background inference via nessi.structured, wrapped in a
 * trace span (events: model.resolved, llm.completed — metadata only, never
 * prompt or output content).
 */
export const runAiStructured = async <TOutput extends z.ZodType>(
  input: RunAiStructuredInput<TOutput>,
): Promise<RunAiStructuredResult<TOutput>> => {
  return trace.withSpan(
    {
      name: `ai.structured.${input.task}`,
      source: `ai:structured:${input.task}`,
      appId: input.appId,
      category: "ai",
      parent: input.traceParent,
    },
    async (span) => {
      const resolved = await (input.resolveModel ?? resolveAiBackgroundModel)(input.requestedModelId);
      await trace.record({
        context: span,
        event: "model.resolved",
        attributes: { model: resolved.profile.id, providerModel: resolved.profile.model, provider: resolved.profile.provider },
      });

      const startedAt = Date.now();
      const result = await nessi.structured({
        agentId: "cloud-bg",
        provider: resolved.provider,
        systemPrompt: input.systemPrompt,
        input: input.input,
        output: input.output,
        outputName: input.outputName,
        temperature: input.temperature ?? 0,
        maxOutputTokens: input.maxOutputTokens ?? resolved.profile.maxOutputTokens,
        disableReasoning: true,
        signal: input.signal,
      });

      await trace.record({
        context: span,
        event: "llm.completed",
        attributes: {
          model: resolved.profile.id,
          durationMs: Date.now() - startedAt,
          mode: result.structuredMeta.mode,
          repaired: result.structuredMeta.repaired,
          attempts: result.structuredMeta.attempts,
          inputTokens: result.usage?.input,
          outputTokens: result.usage?.output,
        },
      });

      return {
        output: result.output,
        modelProfileId: resolved.profile.id,
        usage: result.usage,
        structuredMeta: result.structuredMeta,
      };
    },
    {
      summarize: (result) => ({ model: result.modelProfileId, mode: result.structuredMeta.mode, repaired: result.structuredMeta.repaired }),
      onError: (error) => (error instanceof StructuredOutputError ? structuredFailureSummary(error) : undefined),
    },
  );
};

/** Metadata-only failure diagnostics: error code, attempts, and per-attempt stop reasons (catches max_tokens truncation). */
const structuredFailureSummary = (error: StructuredOutputError): Record<string, unknown> => {
  const details = error.details as { attempts?: number; aggregate?: LoopAggregate } | undefined;
  return {
    code: error.code,
    attempts: details?.attempts,
    stopReasons: details?.aggregate?.turns?.map((turn) => turn.stopReason ?? "unknown").join(","),
    outputTokens: details?.aggregate?.usage?.output,
  };
};
