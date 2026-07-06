import type { CompactFn, InboundEvent, Input, Message, NessiLoop, OutboundEvent, StoreEntry } from "@valentinkolb/nessi";
import { nessi, truncateMiddle } from "@valentinkolb/nessi";
import { job } from "@valentinkolb/sync";
import { z } from "zod";
import type { RequestActor } from "../server";
import {
  type AiToolApprovalContext,
  aiToolAllowsAlways,
  aiToolApprovalScope,
  hasRememberedAiToolApproval,
  rememberAiToolApproval,
} from "./approvals";
import { createDefaultCloudAiTools } from "./default-tools";
import { resolveAiResourceRunContext } from "./resource-runner";
import { logger } from "../services/logging";
import { readAiSettingsState, resolveAiModel } from "./settings";
import { aiConversationStore } from "./store";
import { aiTurnControlsTopic, createAiEventReplayResponse, publishAiEvent, publishAiTurnControl } from "./stream";
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
  AiTurnRunConfig,
  AiToolApprovalPolicy,
  AiTurnToolSource,
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
const AI_TURN_LEASE_MS = 45_000;
const AI_TURN_HEARTBEAT_MS = 10_000;
const AI_RUNTIME_RECOVERY_INTERVAL_MS = 30_000;
const AI_TOOL_START_CONTINUATION_TIMEOUT_MS = 5_000;
const AI_WORKER_ID = `worker-${crypto.randomUUID()}`;
const log = logger("ai:runtime");

type PendingToolStart = {
  callId: string;
  name: string;
};

class AiToolStreamStalledError extends Error {
  constructor(
    readonly pending: PendingToolStart,
  ) {
    super(`The model started the "${pending.name}" tool but did not finish the tool call. Please try again.`);
    this.name = "AiToolStreamStalledError";
  }
}

const isToolStartContinuation = (pending: PendingToolStart | null, event: OutboundEvent): boolean => {
  if (!pending) return false;
  return (
    (event.type === "tool_call" && event.callId === pending.callId) ||
    ((event.type === "tool_error" || event.type === "tool_cancel") && event.callId === pending.callId)
  );
};

const staleToolStartCancelEvent = (pending: PendingToolStart, loopId: string): Extract<OutboundEvent, { type: "tool_cancel" }> => ({
  type: "tool_cancel",
  agentId: "cloud",
  loopId,
  callId: pending.callId,
  name: pending.name,
  reason: "stream_ended_before_tool_call",
  message: `The model started the "${pending.name}" tool but continued without valid tool call details.`,
});

const getStaleToolStartCancelEvent = (
  pending: PendingToolStart | null,
  event: OutboundEvent,
  loopId: string,
): Extract<OutboundEvent, { type: "tool_cancel" }> | null => {
  if (!pending || isToolStartContinuation(pending, event)) return null;
  return staleToolStartCancelEvent(pending, loopId);
};

const nessiEventLoopId = (event: OutboundEvent): string | null => {
  const value = (event as { loopId?: unknown }).loopId;
  return typeof value === "string" && value.trim() ? value : null;
};

const withTurnLoopId = (event: OutboundEvent, loopId: string): OutboundEvent => {
  if (nessiEventLoopId(event)) return event;
  return { ...event, loopId };
};

const readNextNessiEvent = async (
  iterator: AsyncIterator<OutboundEvent>,
  pendingToolStart: PendingToolStart | null,
): Promise<IteratorResult<OutboundEvent>> => {
  let timedOut = false;
  const next = iterator.next().catch((error) => {
    if (timedOut) return { done: true, value: undefined as never };
    throw error;
  });
  if (!pendingToolStart) return await next;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      next,
      new Promise<IteratorResult<OutboundEvent>>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new AiToolStreamStalledError(pendingToolStart));
        }, AI_TOOL_START_CONTINUATION_TIMEOUT_MS);
        if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

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
  maxOutputTokens?: number;
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

export type RunAiTurnInput = {
  conversationId: string;
  input: Input;
  actor?: RequestActor;
  modelPolicy?: AiModelPolicy;
  requestedModelId?: string;
  systemPrompt?: string;
  resourceContext?: string;
  tools?: AiRuntimeTool[];
  toolSource?: AiTurnToolSource;
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
  stopControls: () => void;
};

const activeAiTurns = new Map<string, ActiveAiTurn>();

const inputIncludesFiles = (input: Input): boolean =>
  Array.isArray(input) && input.some((part) => typeof part === "object" && part.type === "file");

export const listPendingAiTurnActions = (input: { conversationId: string; turnId: string }): Promise<AiPendingTurnAction[]> =>
  aiConversationStore.listPendingTurnActions(input);

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

const abortActiveTurn = (turnId: string, turn: ActiveAiTurn) => {
  releasePendingActionsForAbort(turnId, turn);
  turn.abortController.abort();
  turn.loop.abort();
};

export const abortAiTurn = async (input: {
  conversationId: string;
  turnId: string;
}): Promise<{ ok: true }> => {
  const startedAt = Date.now();
  const result = await aiConversationStore.requestTurnAbort({ ...input, reason: "user" });
  if (!result.found) {
    log.info("AI turn abort ignored for missing turn", {
      conversationId: input.conversationId,
      turnId: input.turnId,
      durationMs: Date.now() - startedAt,
    });
    return { ok: true };
  }

  await aiConversationStore.clearPendingTurnActions(input);
  const turn = activeAiTurns.get(input.turnId);
  if (turn?.conversationId === input.conversationId) {
    abortActiveTurn(input.turnId, turn);
  }

  if (result.aborted) {
    await publishAiEvent({
      type: "done",
      turnId: input.turnId,
      conversationId: input.conversationId,
      loopId: input.turnId,
      reason: "aborted",
      aggregate: null,
    }).catch(() => undefined);
    await publishAiTurnControl({ type: "abort", turnId: input.turnId, conversationId: input.conversationId }).catch(() => undefined);
  }

  log.info("AI turn abort requested", {
    conversationId: input.conversationId,
    turnId: input.turnId,
    previousStatus: result.status,
    changedState: result.aborted,
    durationMs: Date.now() - startedAt,
  });
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
  const activePending = turn?.conversationId === input.conversationId ? turn.pendingActions.get(input.callId) : undefined;
  const storedPending = await aiConversationStore.getPendingTurnAction(input);
  const pending = activePending ?? storedPending;
  if (!pending) {
    return { ok: false, status: 404, message: "AI action request not found." };
  }

  let event: InboundEvent;
  if (input.action.type === "approval_response") {
    if (pending.kind === "client_tool") {
      return { ok: false, status: 400, message: "Frontend tool requests require a tool result." };
    }

    const approvalContext = input.toolApprovalContext ?? turn?.toolApprovalContext;
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
    if (activePending?.outputSchema) {
      const parsed = activePending.outputSchema.safeParse(input.action.result);
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

  const resolved = await aiConversationStore.resolvePendingTurnAction({ ...input, event });
  if (!resolved) return { ok: false, status: 404, message: "AI action request not found." };

  if (turn?.conversationId === input.conversationId) {
    turn.pendingActions.delete(input.callId);
    turn.loop.push(event);
  }
  await publishAiTurnControl({ type: "action", conversationId: input.conversationId, turnId: input.turnId, callId: input.callId }).catch(
    () => undefined,
  );
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

const pushResolvedPendingAction = async (turnId: string, turn: ActiveAiTurn, callId: string): Promise<void> => {
  const pending = await aiConversationStore.getPendingTurnAction({ conversationId: turn.conversationId, turnId, callId });
  if (!pending?.resolvedEvent || !turn.pendingActions.has(callId)) return;
  turn.pendingActions.delete(callId);
  turn.loop.push(pending.resolvedEvent);
};

const startTurnControlWatcher = (turnId: string, turn: ActiveAiTurn): (() => void) => {
  const controller = new AbortController();
  let stopped = false;

  const pollResolvedActions = async () => {
    if (stopped || turn.pendingActions.size === 0) return;
    await Promise.all([...turn.pendingActions.keys()].map((callId) => pushResolvedPendingAction(turnId, turn, callId))).catch(() => undefined);
  };

  const pollTimer = setInterval(() => {
    void pollResolvedActions();
  }, 2_000);
  if (typeof pollTimer === "object" && pollTimer && "unref" in pollTimer && typeof pollTimer.unref === "function") pollTimer.unref();

  void (async () => {
    const liveAfter = (await aiTurnControlsTopic.latestCursor({ tenantId: turn.conversationId }).catch(() => null)) ?? "0-0";
    for await (const event of aiTurnControlsTopic.live({
      tenantId: turn.conversationId,
      after: liveAfter,
      signal: controller.signal,
    })) {
      if (event.data.turnId !== turnId || event.data.conversationId !== turn.conversationId) continue;
      if (event.data.type === "abort") {
        abortActiveTurn(turnId, turn);
        continue;
      }
      await pushResolvedPendingAction(turnId, turn, event.data.callId);
    }
  })().catch(() => undefined);

  return () => {
    stopped = true;
    clearInterval(pollTimer);
    controller.abort();
  };
};

const startTurnLeaseHeartbeat = (turnId: string, turn: ActiveAiTurn): (() => void) => {
  let stopped = false;
  let transientFailures = 0;
  const heartbeat = async () => {
    if (stopped) return;
    let ok = false;
    try {
      ok = await aiConversationStore.heartbeatTurn({
        conversationId: turn.conversationId,
        turnId,
        leaseOwner: AI_WORKER_ID,
        leaseMs: AI_TURN_LEASE_MS,
      });
      transientFailures = 0;
    } catch {
      transientFailures += 1;
      if (transientFailures < 3) return;
    }
    if (!ok && !stopped) abortActiveTurn(turnId, turn);
  };

  const timer = setInterval(() => {
    void heartbeat();
  }, AI_TURN_HEARTBEAT_MS);
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") timer.unref();
  void heartbeat();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
};

type AiTurnJobInput = {
  conversationId: string;
  turnId: string;
};

type MaterializedAiTurnRunInput = Omit<RunAiTurnInput, "conversationId"> & {
  input: Input;
  signal: AbortSignal;
};

class AiTurnLeaseBusyError extends Error {
  constructor() {
    super("AI turn lease is currently owned by another worker.");
  }
}

const failPersistedTurn = async (input: AiTurnJobInput, error: unknown): Promise<void> => {
  const message = error instanceof Error ? error.message : "AI turn failed";
  log.error("AI turn failed before runner start", {
    conversationId: input.conversationId,
    turnId: input.turnId,
    error: message,
  });
  await publishAiEvent({
    type: "error",
    turnId: input.turnId,
    conversationId: input.conversationId,
    loopId: input.turnId,
    message,
    retryable: false,
  }).catch(() => undefined);
  await aiConversationStore.completeTurn({
    turnId: input.turnId,
    status: "failed",
    error: message,
    leaseOwner: AI_WORKER_ID,
  });
};

const materializeRunConfig = async (config: AiTurnRunConfig, signal: AbortSignal): Promise<MaterializedAiTurnRunInput> => {
  const source = config.toolSource ?? { kind: "none" };
  if (source.kind === "resource") {
    if (!config.actor) throw new Error("AI resource turn is missing an actor.");
    const resource = await resolveAiResourceRunContext({
      resourceKey: source.resourceKey,
      params: source.params,
      actor: config.actor,
      signal,
    });
    return {
      ...config,
      actor: resource.actor,
      modelPolicy: resource.modelPolicy,
      systemPrompt: resource.systemPrompt,
      resourceContext: resource.resourceContext,
      tools: resource.tools,
      toolApprovalContext: {
        actorUserId: resource.ownerUserId,
        appId: resource.descriptor.appId,
        resource: resource.conversationResource,
      },
      signal,
    };
  }

  return {
    ...config,
    tools: source.kind === "default" ? createDefaultCloudAiTools() : [],
    signal,
  };
};

const runPersistedAiTurn = async (input: AiTurnJobInput, signal: AbortSignal): Promise<void> => {
  const startedAt = Date.now();
  const claimed = await aiConversationStore.claimTurnLease({
    conversationId: input.conversationId,
    turnId: input.turnId,
    leaseOwner: AI_WORKER_ID,
    leaseMs: AI_TURN_LEASE_MS,
  });
  if (!claimed) {
    if (await aiConversationStore.isTurnRunning(input)) {
      log.info("AI turn lease busy", {
        conversationId: input.conversationId,
        turnId: input.turnId,
        workerId: AI_WORKER_ID,
      });
      throw new AiTurnLeaseBusyError();
    }
    return;
  }

  const config = await aiConversationStore.getTurnRunConfig(input);
  if (!config) {
    await failPersistedTurn(input, new Error("AI turn is missing its run configuration."));
    return;
  }

  let runInput: MaterializedAiTurnRunInput;
  let validated: Awaited<ReturnType<typeof validateAiTurnRequest>>;
  try {
    runInput = await materializeRunConfig(config, signal);
    validated = await validateAiTurnRequest(runInput);
  } catch (error) {
    await failPersistedTurn(input, error);
    return;
  }
  const { settings, resolved } = validated;
  const loopId = input.turnId;
  let firstTokenMs: number | null = null;
  let latestAggregate: Extract<OutboundEvent, { type: "done" }>["aggregate"] | null = null;
  let nessiEventCount = 0;

  const store = aiConversationStore.createSessionStore({
    conversationId: input.conversationId,
    modelProfileId: resolved.profile.id,
    turnId: input.turnId,
  });
  const systemPrompt = buildSystemPrompt(settings.globalInstructions, runInput.systemPrompt, runInput.resourceContext);
  const preparedTools = prepareAiTools({
    tools: resolved.profile.capabilities.includes("tools") ? runInput.tools : [],
    actor: runInput.actor,
  });

  const abortController = new AbortController();
  const abortFromJob = () => abortController.abort();
  if (signal.aborted) abortController.abort();
  else signal.addEventListener("abort", abortFromJob, { once: true });
  const loop = nessi({
    agentId: "cloud",
    loopId,
    input: runInput.input,
    provider: resolved.provider,
    systemPrompt,
    store,
    tools: preparedTools.tools,
    maxTurns: preparedTools.tools.length > 0 ? 8 : 1,
    temperature: resolved.profile.temperature,
    maxOutputTokens: resolved.profile.maxOutputTokens,
    compact: createCloudCompactFn({
      conversationId: input.conversationId,
      modelProfileId: resolved.profile.id,
      prompt: settings.compactionPrompt,
      maxOutputTokens: resolved.profile.maxOutputTokens,
      signal: abortController.signal,
    }),
    maxToolResultChars: settings.maxToolResultChars,
    signal: abortController.signal,
  });
  const activeTurn: ActiveAiTurn = {
    conversationId: input.conversationId,
    loop,
    abortController,
    pendingActions: new Map(),
    toolApprovalContext: runInput.toolApprovalContext,
    stopControls: () => undefined,
  };
  const stopControls = startTurnControlWatcher(input.turnId, activeTurn);
  const stopHeartbeat = startTurnLeaseHeartbeat(input.turnId, activeTurn);
  activeTurn.stopControls = () => {
    stopControls();
    stopHeartbeat();
  };
  activeAiTurns.set(input.turnId, activeTurn);

  let finalStatus: "completed" | "failed" | "aborted" = "failed";
  let finalError: string | null = null;
  let internalFailure = false;
  let pendingToolStart: PendingToolStart | null = null;
  let missingLoopIdEventCount = 0;
  let mismatchedLoopIdEventCount = 0;
  const iterator = loop[Symbol.asyncIterator]();

  const write = (event: AiStreamEvent) => publishAiEvent({ ...event, loopId });
  const isLeaseOwner = () =>
    aiConversationStore.isTurnLeaseOwner({
      conversationId: input.conversationId,
      turnId: input.turnId,
      leaseOwner: AI_WORKER_ID,
    });

  try {
    await write({
      type: "turn_start",
      turnId: input.turnId,
      conversationId: input.conversationId,
      modelProfileId: resolved.profile.id,
      providerModel: resolved.provider.model,
    });

    while (true) {
      const next = await readNextNessiEvent(iterator, pendingToolStart);
      if (next.done) break;
      const rawEvent = next.value;
      const rawEventLoopId = nessiEventLoopId(rawEvent);
      const event = withTurnLoopId(rawEvent, loopId);
      const matchedToolStart = event.type === "tool_call" && pendingToolStart?.callId === event.callId ? pendingToolStart : null;
      const staleToolStartCancel = getStaleToolStartCancelEvent(pendingToolStart, event, loopId);
      if (staleToolStartCancel) {
        await write({ type: "nessi", turnId: input.turnId, conversationId: input.conversationId, event: staleToolStartCancel });
      }
      if (matchedToolStart || staleToolStartCancel || ((event.type === "tool_error" || event.type === "tool_cancel") && pendingToolStart?.callId === event.callId)) {
        pendingToolStart = null;
      }

      if (!(await isLeaseOwner())) {
        finalStatus = "aborted";
        finalError = null;
        abortController.abort();
        loop.abort();
        break;
      }

      if (!rawEventLoopId) {
        missingLoopIdEventCount += 1;
        if (missingLoopIdEventCount === 1) {
          log.warn("AI turn received Nessi event without loop id; using turn id", {
            conversationId: input.conversationId,
            turnId: input.turnId,
            eventType: event.type,
          });
        }
      } else if (event.loopId !== loopId) {
        mismatchedLoopIdEventCount += 1;
        log.warn("AI turn received mismatched Nessi loop id", {
          conversationId: input.conversationId,
          turnId: input.turnId,
          expectedLoopId: loopId,
          receivedLoopId: event.loopId,
          eventType: event.type,
        });
      }

      if (event.type === "action_request") {
        const activeTurn = activeAiTurns.get(input.turnId);
        const pending = pendingActionFromNessiEvent(event, preparedTools);
        activeTurn?.pendingActions.set(event.callId, pending);
        await aiConversationStore.savePendingTurnAction({
          turnId: input.turnId,
          conversationId: input.conversationId,
          callId: pending.callId,
          kind: pending.kind,
          name: pending.name,
          args: pending.args,
          message: pending.message,
          approvalScope: pending.approvalScope,
          allowAlways: pending.allowAlways,
          frontendMode: pending.frontendMode,
          resolvedEvent: null,
        });

        if (pending.kind === "client_tool") {
          await aiToolAudit.noteToolCall({
            conversationId: input.conversationId,
            turnId: input.turnId,
            callId: pending.callId,
            toolName: pending.name,
            location: pending.frontendMode ?? "client",
            args: pending.args,
            status: "waiting_for_frontend",
          });
        } else {
          await aiToolAudit.noteApprovalRequested({
            conversationId: input.conversationId,
            turnId: input.turnId,
            callId: pending.callId,
            toolName: pending.name,
            location: "server",
            args: pending.args,
          });
        }

        if (pending.kind !== "client_tool" && pending.allowAlways && runInput.toolApprovalContext) {
          const remembered = await hasRememberedAiToolApproval(runInput.toolApprovalContext, {
            toolName: pending.name,
            approvalScope: pending.approvalScope,
          });
          if (remembered) {
            const approvalEvent: InboundEvent = { type: "approval_response", callId: event.callId, approved: true };
            await aiToolAudit.noteApprovalResolved({
              turnId: input.turnId,
              callId: event.callId,
              approvalState: "approved_by_preference",
            });
            await aiConversationStore.resolvePendingTurnAction({
              conversationId: input.conversationId,
              turnId: input.turnId,
              callId: event.callId,
              event: approvalEvent,
            });
            activeTurn?.pendingActions.delete(event.callId);
            loop.push(approvalEvent);
            continue;
          }
        }

        await write(
          pending.kind === "client_tool"
            ? {
                type: "frontend_tool",
                turnId: input.turnId,
                conversationId: input.conversationId,
                callId: pending.callId,
                name: pending.name,
                args: pending.args,
                mode: pending.frontendMode ?? "client",
              }
            : {
                type: "approval_request",
                turnId: input.turnId,
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
      nessiEventCount += 1;
      if ((event.type === "text" || event.type === "thinking") && firstTokenMs === null) {
        firstTokenMs = Date.now() - startedAt;
        log.info("AI turn first token", {
          conversationId: input.conversationId,
          turnId: input.turnId,
          modelProfileId: resolved.profile.id,
          providerModel: resolved.provider.model,
          firstTokenMs,
        });
      }

      if (event.type === "tool_call") {
        await aiToolAudit.noteToolCall({
          conversationId: input.conversationId,
          turnId: input.turnId,
          callId: event.callId,
          toolName: event.name,
          location: preparedTools.frontendModes.get(event.name) ?? "server",
          args: event.args,
        });
        if (matchedToolStart) {
          await aiToolAudit.noteToolStarted({
            conversationId: input.conversationId,
            turnId: input.turnId,
            callId: event.callId,
            toolName: event.name,
          });
        }
      } else if (event.type === "tool_start") {
        pendingToolStart = { callId: event.callId, name: event.name };
      } else if (event.type === "tool_end") {
        await aiToolAudit.noteToolCompleted({
          turnId: input.turnId,
          callId: event.callId,
          result: event.result,
          isError: event.isError,
        });
      }

      await write({ type: "nessi", turnId: input.turnId, conversationId: input.conversationId, event });
      if (event.type === "error") {
        finalError = event.error;
      }
      if (event.type === "done") {
        finalStatus = statusForDoneReason(event.reason);
        const aggregate = event.aggregate ?? null;
        latestAggregate = aggregate;
        if (aggregate && aggregate.assistantMessageCount > 0) {
          await aiConversationStore.setLatestAssistantLoopAggregate({
            conversationId: input.conversationId,
            loopId,
            aggregate,
            doneReason: event.reason,
          });
        }
        await write({ type: "done", turnId: input.turnId, conversationId: input.conversationId, reason: event.reason, aggregate });
      }
    }
  } catch (error) {
    internalFailure = error instanceof AiToolStreamStalledError;
    if (internalFailure) {
      abortController.abort();
      void iterator.return?.().catch(() => undefined);
    }
    const aborted = !internalFailure && (abortController.signal.aborted || !(await isLeaseOwner().catch(() => false)));
    finalStatus = aborted ? "aborted" : "failed";
    finalError = aborted ? null : error instanceof Error ? error.message : "AI turn failed";
    if (!aborted) {
      log.error("AI turn failed", {
        conversationId: input.conversationId,
        turnId: input.turnId,
        modelProfileId: resolved.profile.id,
        providerModel: resolved.provider.model,
        durationMs: Date.now() - startedAt,
        firstTokenMs,
        error: finalError ?? "AI turn failed",
      });
      await write({
        type: "error",
        turnId: input.turnId,
        conversationId: input.conversationId,
        message: finalError ?? "AI turn failed",
        retryable: false,
      }).catch(() => undefined);
    }
  } finally {
    signal.removeEventListener("abort", abortFromJob);
    activeAiTurns.get(input.turnId)?.stopControls();
    activeAiTurns.delete(input.turnId);
    if (abortController.signal.aborted && !internalFailure) {
      finalStatus = "aborted";
      finalError = null;
    }
    log.info("AI turn finished", {
      conversationId: input.conversationId,
      turnId: input.turnId,
      modelProfileId: resolved.profile.id,
      providerModel: resolved.provider.model,
      status: finalStatus,
      durationMs: Date.now() - startedAt,
      firstTokenMs,
      nessiEventCount,
      toolCallCount: latestAggregate?.toolCallCount ?? 0,
      toolErrorCount: latestAggregate?.toolErrorCount ?? 0,
      toolIssueCount: latestAggregate?.toolIssueCount ?? 0,
      toolMalformedCount: latestAggregate?.toolMalformedCount ?? 0,
      toolCancelledCount: latestAggregate?.toolCancelledCount ?? 0,
      missingLoopIdEventCount,
      mismatchedLoopIdEventCount,
      inputTokens: latestAggregate?.usage?.input ?? null,
      outputTokens: latestAggregate?.usage?.output ?? null,
      totalTokens: latestAggregate?.usage?.total ?? null,
    });
    await aiConversationStore.completeTurn({ turnId: input.turnId, status: finalStatus, error: finalError, leaseOwner: AI_WORKER_ID });
  }
};

const aiTurnRunnerJob = job<AiTurnJobInput>({
  id: "cloud-ai-turn-runner",
  defaults: { leaseMs: AI_TURN_LEASE_MS, keyTtlMs: 24 * 60 * 60 * 1000 },
  process: async ({ ctx }) => {
    await runPersistedAiTurn(ctx.input, ctx.signal);
  },
  after: async ({ ctx }) => {
    if (ctx.error instanceof AiTurnLeaseBusyError) {
      ctx.reschedule({ delayMs: Math.min(5_000 + ctx.failureCount * 1_000, 30_000) });
    }
  },
});

const submitAiTurnJob = (input: AiTurnJobInput): Promise<unknown> =>
  aiTurnRunnerJob.submit({
    key: `turn:${input.turnId}`,
    input,
    leaseMs: AI_TURN_LEASE_MS,
  });

export const recoverAiRuntimeTurns = async (input: { limit?: number } = {}) => {
  const startedAt = Date.now();
  const turns = await aiConversationStore.listRecoverableTurns({ limit: input.limit ?? 100 });
  let submitted = 0;
  let failed = 0;

  await Promise.all(
    turns.map(async (turn) => {
      try {
        await submitAiTurnJob({ conversationId: turn.conversationId, turnId: turn.id });
        submitted += 1;
      } catch (error) {
        failed += 1;
        log.warn("AI turn recovery submit failed", {
          conversationId: turn.conversationId,
          turnId: turn.id,
          error: error instanceof Error ? error.message : "Failed to submit AI turn recovery job",
        });
      }
    }),
  );

  if (turns.length > 0 || failed > 0) {
    log.info("AI runtime recovery sweep", {
      recoverableTurns: turns.length,
      submitted,
      failed,
      durationMs: Date.now() - startedAt,
    });
  }

  return { recoverableTurns: turns.length, submitted, failed };
};

export const startAiRuntimeRecovery = (input: { intervalMs?: number; limit?: number } = {}): (() => void) => {
  const intervalMs = Math.max(5_000, Math.floor(input.intervalMs ?? AI_RUNTIME_RECOVERY_INTERVAL_MS));
  let stopped = false;
  const run = () => {
    if (stopped) return;
    void recoverAiRuntimeTurns({ limit: input.limit }).catch((error) => {
      log.warn("AI runtime recovery sweep failed", {
        error: error instanceof Error ? error.message : "AI runtime recovery failed",
      });
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
};

export const createAiTurnResponse = async (input: RunAiTurnInput): Promise<Response> => {
  const { resolved } = await validateAiTurnRequest(input);
  const runConfig: AiTurnRunConfig = {
    input: input.input,
    actor: input.actor,
    modelPolicy: input.modelPolicy,
    requestedModelId: input.requestedModelId,
    systemPrompt: input.systemPrompt,
    resourceContext: input.resourceContext,
    toolSource: input.toolSource ?? { kind: "none" },
    toolApprovalContext: input.toolApprovalContext,
  };

  const turn = await aiConversationStore.createTurn({
    conversationId: input.conversationId,
    modelProfileId: resolved.profile.id,
    leaseOwner: "queued",
    leaseMs: 5 * 60_000,
    runConfig,
  });

  try {
    await submitAiTurnJob({ conversationId: input.conversationId, turnId: turn.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to enqueue AI turn.";
    await aiConversationStore.completeTurn({ turnId: turn.id, status: "failed", error: message });
    await publishAiEvent({
      type: "error",
      turnId: turn.id,
      conversationId: input.conversationId,
      loopId: turn.id,
      message,
      retryable: true,
    }).catch(() => undefined);
    throw error;
  }

  return createAiEventReplayResponse({
    conversationId: input.conversationId,
    turnId: turn.id,
    after: "0-0",
    signal: input.signal,
  });
};

export const __aiRuntimeTest = {
  getStaleToolStartCancelEvent,
  withTurnLoopId,
};
