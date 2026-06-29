import type { CompactFn, InboundEvent, Input, Message, NessiLoop, OutboundEvent, StoreEntry } from "@valentinkolb/nessi";
import { nessi, truncateMiddle } from "@valentinkolb/nessi";
import { z } from "zod";
import type { RequestActor } from "../server";
import {
  type AiToolApprovalContext,
  aiToolAllowsAlways,
  aiToolApprovalScope,
  hasRememberedAiToolApproval,
  rememberAiToolApproval,
} from "./approvals";
import { readAiSettingsState, resolveAiModel } from "./settings";
import { aiConversationStore } from "./store";
import { createAiEventReplayResponse, publishAiEvent } from "./stream";
import { aiToolAudit } from "./tool-audit";
import { prepareAiTools } from "./tools";
import type {
  AiFrontendToolMode,
  AiModelPolicy,
  AiPendingTurnAction,
  AiRuntimeTool,
  AiSettingsError,
  AiSettingsState,
  AiStreamEvent,
  AiToolApprovalPolicy,
} from "./types";

const PLATFORM_SYSTEM_PROMPT = [
  "You are Cloud AI, an assistant running inside the user's Cloud workspace.",
  "Follow the user's current permissions. Never claim access to data or actions that were not provided by the server context or tools.",
  "Be concise, precise, and use the user's language unless they ask otherwise.",
].join("\n");

const DEFAULT_COMPACTION_PROMPT = [
  "Summarize the chat context for a future assistant turn.",
  "Preserve user goals, preferences, constraints, decisions, important facts, tool results, pending tasks, and unresolved questions.",
  "Do not invent details. Keep the summary compact but complete enough that the next assistant can continue correctly.",
].join("\n");

const COMPACTION_FILL_RATIO = 0.72;
const COMPACTION_KEEP_RECENT_ENTRIES = 6;
const COMPACTION_MAX_SOURCE_CHARS = 24_000;
const COMPACTION_MAX_TOOL_RESULT_CHARS = 1_200;

export const isAiSettingsError = (error: unknown): error is Error & { aiError: AiSettingsError } =>
  error instanceof Error && typeof (error as Error & { aiError?: unknown }).aiError === "object";

const buildSystemPrompt = (globalInstructions: string, appPrompt?: string, resourceContext?: string): string =>
  [PLATFORM_SYSTEM_PROMPT, globalInstructions.trim(), appPrompt?.trim(), resourceContext?.trim()].filter(Boolean).join("\n\n");

const statusForDoneReason = (reason: string) => {
  if (reason === "stop") return "completed" as const;
  if (reason === "aborted") return "aborted" as const;
  return "failed" as const;
};

const textFromAssistant = (message: Extract<Message, { role: "assistant" }>): string =>
  message.content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "thinking") return `[thinking]\n${truncateMiddle(block.thinking, 1_000)}`;
      return `[tool_call ${block.name} ${block.id}]\n${truncateMiddle(JSON.stringify(block.args), 1_000)}`;
    })
    .filter(Boolean)
    .join("\n\n");

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

const createCloudCompactFn = (input: {
  conversationId: string;
  modelProfileId: string;
  prompt: string;
  signal: AbortSignal;
}): CompactFn => {
  return (ctx) => {
    if (!ctx.force && (typeof ctx.fillRatio !== "number" || ctx.fillRatio < COMPACTION_FILL_RATIO)) return null;
    if (!ctx.force && ctx.entries.length <= COMPACTION_KEEP_RECENT_ENTRIES + 2) return null;

    const checkpointIndex = Math.max(0, ctx.entries.length - COMPACTION_KEEP_RECENT_ENTRIES - 1);
    const checkpoint = ctx.entries[checkpointIndex];
    if (!checkpoint || checkpoint.seq <= 0) return null;

    const sourceEntries = ctx.entries.slice(0, checkpointIndex + 1);
    if (sourceEntries.length < 2) return null;

    return (async () => {
      const source = truncateMiddle(sourceEntries.map(messageToCompactionText).join("\n\n"), COMPACTION_MAX_SOURCE_CHARS);
      const result = await ctx.provider.complete({
        systemPrompt: (input.prompt.trim() || DEFAULT_COMPACTION_PROMPT).trim(),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Summarize these chat entries for future context:\n\n${source}`,
              },
            ],
          },
        ],
        tools: [],
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

export type RunAiTurnInput = {
  conversationId: string;
  input: Input;
  actor?: RequestActor;
  modelPolicy?: AiModelPolicy;
  requestedModelId?: string;
  systemPrompt?: string;
  resourceContext?: string;
  tools?: AiRuntimeTool[];
  toolApprovalContext?: AiToolApprovalContext;
  signal?: AbortSignal;
};

export type ValidateAiTurnInput = Pick<RunAiTurnInput, "input" | "modelPolicy" | "requestedModelId">;

export const validateAiTurnRequest = async (
  input: ValidateAiTurnInput,
): Promise<{ settings: Extract<AiSettingsState, { ok: true }>; resolved: Awaited<ReturnType<typeof resolveAiModel>> }> => {
  const settings = await readAiSettingsState();
  if (!settings.ok) throw Object.assign(new Error(settings.error.message), { aiError: settings.error });
  if (!settings.enabled) {
    throw Object.assign(new Error("AI is disabled."), {
      aiError: { code: "ai_disabled", message: "AI is disabled." } satisfies AiSettingsError,
    });
  }

  const resolved = await resolveAiModel(input.modelPolicy ?? { kind: "platform-default" }, input.requestedModelId);
  if (inputIncludesFiles(input.input) && !resolved.profile.capabilities.includes("vision")) {
    throw Object.assign(new Error(`AI model "${resolved.profile.id}" does not support image input.`), {
      aiError: {
        code: "model_policy_mismatch",
        message: `AI model "${resolved.profile.label}" does not support image input.`,
        fields: { modelProfileId: "Choose a model with vision support." },
      } satisfies AiSettingsError,
    });
  }

  return { settings, resolved };
};

export const AiTurnActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("approval_response"),
    approved: z.boolean(),
    remember: z.literal("always").optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    result: z.unknown(),
  }),
]);

export type AiTurnActionInput = z.infer<typeof AiTurnActionSchema>;

type PendingAiAction = {
  kind: "approval" | "custom_approval" | "client_tool";
  callId: string;
  name: string;
  args: unknown;
  message?: string;
  approvalPolicy?: AiToolApprovalPolicy;
  approvalScope: string;
  allowAlways: boolean;
  frontendMode?: AiFrontendToolMode;
  outputSchema?: z.ZodType;
};

type ActiveAiTurn = {
  conversationId: string;
  loop: NessiLoop;
  abortController: AbortController;
  pendingActions: Map<string, PendingAiAction>;
  toolApprovalContext?: AiToolApprovalContext;
};

const activeAiTurns = new Map<string, ActiveAiTurn>();

const inputIncludesFiles = (input: Input): boolean =>
  Array.isArray(input) && input.some((part) => typeof part === "object" && part.type === "file");

const pendingActionToEvent = (turnId: string, turn: ActiveAiTurn, pending: PendingAiAction): AiPendingTurnAction =>
  pending.kind === "client_tool"
    ? {
        type: "frontend_tool",
        turnId,
        conversationId: turn.conversationId,
        callId: pending.callId,
        name: pending.name,
        args: pending.args,
        mode: pending.frontendMode ?? "client",
      }
    : {
        type: "approval_request",
        turnId,
        conversationId: turn.conversationId,
        callId: pending.callId,
        name: pending.name,
        args: pending.args,
        message: pending.message,
        allowAlways: pending.allowAlways,
      };

export const listPendingAiTurnActions = (input: { conversationId: string; turnId: string }): AiPendingTurnAction[] => {
  const turn = activeAiTurns.get(input.turnId);
  if (!turn || turn.conversationId !== input.conversationId) return [];
  return [...turn.pendingActions.values()].map((pending) => pendingActionToEvent(input.turnId, turn, pending));
};

const releasePendingActionsForAbort = (turnId: string, turn: ActiveAiTurn) => {
  for (const pending of turn.pendingActions.values()) {
    if (pending.kind === "client_tool") {
      turn.loop.push({ type: "tool_result", callId: pending.callId, result: { error: "AI turn aborted." } });
      void aiToolAudit
        .noteToolCompleted({
          turnId,
          callId: pending.callId,
          result: "AI turn aborted.",
          isError: true,
        })
        .catch(() => undefined);
      continue;
    }

    turn.loop.push({ type: "approval_response", callId: pending.callId, approved: false });
    void aiToolAudit
      .noteApprovalResolved({
        turnId,
        callId: pending.callId,
        approvalState: "rejected",
      })
      .catch(() => undefined);
  }
  turn.pendingActions.clear();
};

const scheduleAbortCleanup = (turnId: string, turn: ActiveAiTurn) => {
  const timer = setTimeout(() => {
    if (activeAiTurns.get(turnId) !== turn) return;
    activeAiTurns.delete(turnId);
    void aiConversationStore.completeTurn({ turnId, status: "aborted", error: null }).catch((error) => {
      console.error("Failed to mark aborted AI turn", error);
    });
  }, 10_000);
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") timer.unref();
};

export const abortAiTurn = (input: {
  conversationId: string;
  turnId: string;
}): { ok: true } | { ok: false; status: 409; message: string } => {
  const turn = activeAiTurns.get(input.turnId);
  if (!turn || turn.conversationId !== input.conversationId) {
    return { ok: false, status: 409, message: "AI turn is not running on this worker." };
  }

  releasePendingActionsForAbort(input.turnId, turn);
  turn.abortController.abort();
  turn.loop.abort();
  scheduleAbortCleanup(input.turnId, turn);
  return { ok: true };
};

export const submitAiTurnAction = async (input: {
  conversationId: string;
  turnId: string;
  callId: string;
  action: AiTurnActionInput;
  toolApprovalContext?: AiToolApprovalContext;
}): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; message: string }> => {
  const turn = activeAiTurns.get(input.turnId);
  if (!turn || turn.conversationId !== input.conversationId) {
    return { ok: false, status: 409, message: "AI turn is not awaiting actions." };
  }

  const pending = turn.pendingActions.get(input.callId);
  if (!pending) {
    return { ok: false, status: 404, message: "AI action request not found." };
  }

  let event: InboundEvent;
  if (input.action.type === "approval_response") {
    if (pending.kind === "client_tool") {
      return { ok: false, status: 400, message: "Frontend tool requests require a tool result." };
    }

    const approvalContext = input.toolApprovalContext ?? turn.toolApprovalContext;
    if (input.action.approved && input.action.remember === "always" && pending.allowAlways && approvalContext) {
      await rememberAiToolApproval(approvalContext, {
        toolName: pending.name,
        approvalScope: pending.approvalScope,
      });
    }

    await aiToolAudit.noteApprovalResolved({
      turnId: input.turnId,
      callId: input.callId,
      approvalState: input.action.approved ? (input.action.remember === "always" ? "approved_always" : "approved_once") : "rejected",
    });

    event = { type: "approval_response", callId: input.callId, approved: input.action.approved };
  } else {
    if (pending.kind !== "client_tool") {
      return { ok: false, status: 400, message: "Approval requests require an approval response." };
    }
    if (pending.outputSchema) {
      const parsed = pending.outputSchema.safeParse(input.action.result);
      if (!parsed.success) {
        return {
          ok: false,
          status: 400,
          message: `Frontend tool result does not match the output schema: ${z.prettifyError(parsed.error)}`,
        };
      }
      event = { type: "tool_result", callId: input.callId, result: parsed.data };
    } else {
      event = { type: "tool_result", callId: input.callId, result: input.action.result };
    }
  }

  turn.pendingActions.delete(input.callId);
  turn.loop.push(event);
  return { ok: true };
};

const pendingActionFromNessiEvent = (
  event: Extract<OutboundEvent, { type: "action_request" }>,
  input: {
    approvalPolicies: Map<string, AiToolApprovalPolicy>;
    frontendModes: Map<string, AiFrontendToolMode>;
    outputSchemas: Map<string, z.ZodType>;
  },
): PendingAiAction => {
  const approvalPolicy = input.approvalPolicies.get(event.name);
  const frontendMode = event.kind === "client_tool" ? (input.frontendModes.get(event.name) ?? "client") : undefined;
  return {
    kind: event.kind,
    callId: event.callId,
    name: event.name,
    args: event.args,
    message: event.message,
    approvalPolicy,
    approvalScope: aiToolApprovalScope(event.name, approvalPolicy),
    allowAlways: aiToolAllowsAlways(approvalPolicy),
    frontendMode,
    outputSchema: event.kind === "client_tool" ? input.outputSchemas.get(event.name) : undefined,
  };
};

export const createAiTurnResponse = async (input: RunAiTurnInput): Promise<Response> => {
  const { settings, resolved } = await validateAiTurnRequest(input);

  const turn = await aiConversationStore.createTurn({ conversationId: input.conversationId, modelProfileId: resolved.profile.id });
  const store = aiConversationStore.createSessionStore({ conversationId: input.conversationId, modelProfileId: resolved.profile.id });
  const systemPrompt = buildSystemPrompt(settings.globalInstructions, input.systemPrompt, input.resourceContext);
  const preparedTools = prepareAiTools({
    tools: resolved.profile.capabilities.includes("tools") ? input.tools : [],
    actor: input.actor,
  });

  const abortController = new AbortController();
  const loop = nessi({
    agentId: "cloud",
    input: input.input,
    provider: resolved.provider,
    systemPrompt,
    store,
    tools: preparedTools.tools,
    maxTurns: preparedTools.tools.length > 0 ? 8 : 1,
    compact: createCloudCompactFn({
      conversationId: input.conversationId,
      modelProfileId: resolved.profile.id,
      prompt: settings.compactionPrompt,
      signal: abortController.signal,
    }),
    maxToolResultChars: settings.maxToolResultChars,
    signal: abortController.signal,
  });
  activeAiTurns.set(turn.id, {
    conversationId: input.conversationId,
    loop,
    abortController,
    pendingActions: new Map(),
    toolApprovalContext: input.toolApprovalContext,
  });

  void (async () => {
    let finalStatus: "completed" | "failed" | "aborted" = "failed";
    let finalError: string | null = null;

    const write = (event: AiStreamEvent) => publishAiEvent(event);

    try {
      await write({
        type: "turn_start",
        turnId: turn.id,
        conversationId: input.conversationId,
        modelProfileId: resolved.profile.id,
        providerModel: resolved.provider.model,
      });

      for await (const event of loop) {
        if (event.type === "action_request") {
          const activeTurn = activeAiTurns.get(turn.id);
          const pending = pendingActionFromNessiEvent(event, preparedTools);
          activeTurn?.pendingActions.set(event.callId, pending);

          if (pending.kind === "client_tool") {
            await aiToolAudit.noteToolCall({
              conversationId: input.conversationId,
              turnId: turn.id,
              callId: pending.callId,
              toolName: pending.name,
              location: pending.frontendMode ?? "client",
              args: pending.args,
              status: "waiting_for_frontend",
            });
          } else {
            await aiToolAudit.noteApprovalRequested({
              conversationId: input.conversationId,
              turnId: turn.id,
              callId: pending.callId,
              toolName: pending.name,
              location: "server",
              args: pending.args,
            });
          }

          if (pending.kind !== "client_tool" && pending.allowAlways && input.toolApprovalContext) {
            const remembered = await hasRememberedAiToolApproval(input.toolApprovalContext, {
              toolName: pending.name,
              approvalScope: pending.approvalScope,
            });
            if (remembered) {
              await aiToolAudit.noteApprovalResolved({
                turnId: turn.id,
                callId: event.callId,
                approvalState: "approved_by_preference",
              });
              activeTurn?.pendingActions.delete(event.callId);
              loop.push({ type: "approval_response", callId: event.callId, approved: true });
              continue;
            }
          }

          await write(
            pending.kind === "client_tool"
              ? {
                  type: "frontend_tool",
                  turnId: turn.id,
                  conversationId: input.conversationId,
                  callId: pending.callId,
                  name: pending.name,
                  args: pending.args,
                  mode: pending.frontendMode ?? "client",
                }
              : {
                  type: "approval_request",
                  turnId: turn.id,
                  conversationId: input.conversationId,
                  callId: pending.callId,
                  name: pending.name,
                  args: pending.args,
                  message: pending.message,
                  allowAlways: pending.allowAlways,
                },
          );
          continue;
        }

        if (event.type === "tool_call") {
          await aiToolAudit.noteToolCall({
            conversationId: input.conversationId,
            turnId: turn.id,
            callId: event.callId,
            toolName: event.name,
            location: preparedTools.frontendModes.get(event.name) ?? "server",
            args: event.args,
          });
        } else if (event.type === "tool_start") {
          await aiToolAudit.noteToolStarted({
            conversationId: input.conversationId,
            turnId: turn.id,
            callId: event.callId,
            toolName: event.name,
          });
        } else if (event.type === "tool_end") {
          await aiToolAudit.noteToolCompleted({
            turnId: turn.id,
            callId: event.callId,
            result: event.result,
            isError: event.isError,
          });
        }

        await write({ type: "nessi", turnId: turn.id, conversationId: input.conversationId, event });
        if (event.type === "error") {
          finalError = event.error;
        }
        if (event.type === "done") {
          finalStatus = statusForDoneReason(event.reason);
          await write({ type: "done", turnId: turn.id, conversationId: input.conversationId, reason: event.reason });
        }
      }
    } catch (error) {
      finalStatus = abortController.signal.aborted ? "aborted" : "failed";
      finalError = error instanceof Error ? error.message : "AI turn failed";
      await write({
        type: "error",
        turnId: turn.id,
        conversationId: input.conversationId,
        message: finalError,
        retryable: false,
      }).catch(() => undefined);
    } finally {
      activeAiTurns.delete(turn.id);
      if (abortController.signal.aborted) {
        finalStatus = "aborted";
        finalError = null;
      }
      await aiConversationStore.completeTurn({ turnId: turn.id, status: finalStatus, error: finalError });
    }
  })().catch((error) => {
    console.error("AI turn runner failed", error);
  });

  return createAiEventReplayResponse({
    conversationId: input.conversationId,
    turnId: turn.id,
    after: "0-0",
    signal: input.signal,
  });
};
