import type { CompactEvent, NessiLoop, OutboundEvent } from "@valentinkolb/nessi";
import { compact, nessi } from "@valentinkolb/nessi";
import type { RequestActor } from "../server";
import { logger } from "../services/logging";
import { type AiToolApprovalContext, aiToolAllowsAlways, aiToolApprovalScope, hasRememberedAiToolApproval } from "./approvals";
import { createCloudCompactFn } from "./compaction";
import { createConfiguredDefaultCloudAiTools } from "./default-tools";
import {
  type AiTurnBlock,
  type AiWireEvent,
  applyWireEventToBlocks,
  buildBlocksFromMessages,
  compactionBlockId,
  streamBlockId,
  toolBlockId,
} from "./protocol";
import { resolveAiResourceRunContext } from "./resource-runner";
import type { resolveAiModel } from "./settings";
import { aiConversationStore } from "./store";
import { publishAiWireEvent } from "./stream";
import { aiToolAudit } from "./tool-audit";
import { type PreparedAiTools, prepareAiTools } from "./tools";
import type {
  AiChatTurnRunConfig,
  AiFrontendToolMode,
  AiPendingTurnActionRecord,
  AiRuntimeTool,
  AiStoredMessage,
  AiTurnClaim,
  AiTurnRunConfig,
} from "./types";
import { validateAiTurnRequest } from "./validate";

const log = logger("ai:executor");

const PLATFORM_SYSTEM_PROMPT = [
  "You are Cloud AI, an assistant running inside the user's Cloud workspace.",
  "Follow the user's current permissions. Never claim access to data or actions that were not provided by the server context or tools.",
  "Be concise, precise, and use the user's language unless they ask otherwise.",
].join("\n");

const AI_TURN_LEASE_MS = 45_000;
const AI_COALESCE_MS = 25;
const AI_COALESCE_MAX_CHARS = 512;
const AI_SNAPSHOT_INTERVAL_MS = 1_000;
const AI_ACTION_BUDGET_MS = 24 * 60 * 60_000;

export type ExecutorConfig = {
  leaseOwner: string;
  heartbeatMs: number;
  /** Re-enqueue continuation work after a suspension so any worker can resume it. */
  enqueueContinuation: (input: { conversationId: string; turnId: string }) => Promise<void>;
  /** Settings/model resolution seam — tests inject a fake so they never touch shared settings. */
  validateTurn?: typeof validateAiTurnRequest;
};

type ResolvedModel = Awaited<ReturnType<typeof resolveAiModel>>;
type ValidatedTurn = { settings: Awaited<ReturnType<typeof validateAiTurnRequest>>["settings"]; resolved: ResolvedModel };

const buildSystemPrompt = (globalInstructions: string, appPrompt?: string, resourceContext?: string): string =>
  [PLATFORM_SYSTEM_PROMPT, globalInstructions.trim(), appPrompt?.trim(), resourceContext?.trim()].filter(Boolean).join("\n\n");

// ---------------------------------------------------------------------------
// Baseline rebuild — reconstruct the full active-turn view from persisted rounds
// ---------------------------------------------------------------------------

const rebuildBlocksFromMessages = (messages: AiStoredMessage[], pending: AiPendingTurnActionRecord[]): AiTurnBlock[] => {
  const blocks = buildBlocksFromMessages(messages);
  const indexByCallId = new Map(blocks.map((block, index) => [block.kind === "tool" ? block.callId : `_${index}`, index]));

  for (const action of pending) {
    const at = indexByCallId.get(action.callId);
    const existing = at !== undefined ? blocks[at] : undefined;
    if (existing?.kind === "tool") {
      blocks[at!] = {
        ...existing,
        status: action.kind === "client_tool" ? "awaiting_client" : "awaiting_approval",
        approval: action.kind === "client_tool" ? undefined : { message: action.message, allowAlways: action.allowAlways },
        frontendMode: action.frontendMode,
      };
    }
  }

  return blocks;
};

// ---------------------------------------------------------------------------
// Event mapper — nessi 0.5 block/tool events to Cloud wire block ops
// ---------------------------------------------------------------------------

type BlockSetOp = { type: "block_set"; block: AiTurnBlock };
type BlockDeltaOp = { type: "block_delta"; blockId: string; blockKind: "text" | "thinking"; delta: string };
type BlockOp = BlockSetOp | BlockDeltaOp;

type ToolBlockPatch = Partial<Extract<AiTurnBlock, { kind: "tool" }>> & { name?: string; clearApproval?: boolean };

/**
 * Map nessi's canonical block/tool events to Cloud wire ops. nessi owns block
 * structure and whitespace hygiene; the mapper only (a) scopes stream block ids
 * to (attempt, turn) so re-claimed attempts never collide, and (b) maintains
 * tool blocks keyed by callId, enriched with Cloud status/approval metadata.
 */
const createEventMapper = (attempt: number, seedBlocks: AiTurnBlock[]) => {
  const toolBlocks = new Map<string, Extract<AiTurnBlock, { kind: "tool" }>>();
  for (const block of seedBlocks) {
    if (block.kind === "tool") toolBlocks.set(block.callId, block);
  }
  /** nessi stream block ids (turn-scoped) that belong to tool_call blocks — their deltas are raw args JSON. */
  const toolStreamIds = new Set<string>();
  /** kind per open Cloud stream block id, for delta create-if-missing. */
  const streamKinds = new Map<string, "text" | "thinking">();

  const setTool = (callId: string, patch: ToolBlockPatch): BlockOp => {
    const existing = toolBlocks.get(callId);
    const block: Extract<AiTurnBlock, { kind: "tool" }> = {
      id: toolBlockId(callId),
      kind: "tool",
      callId,
      name: patch.name ?? existing?.name ?? "tool",
      args: "args" in patch ? patch.args : existing?.args,
      status: patch.status ?? existing?.status ?? "running",
      result: "result" in patch ? patch.result : existing?.result,
      isError: "isError" in patch ? patch.isError : existing?.isError,
      approval: patch.clearApproval ? undefined : "approval" in patch ? patch.approval : existing?.approval,
      frontendMode: patch.frontendMode ?? existing?.frontendMode,
    };
    toolBlocks.set(callId, block);
    return { type: "block_set", block };
  };

  const compaction = (status: "running" | "completed" | "failed", result?: Extract<AiTurnBlock, { kind: "compaction" }>["result"]): BlockOp => ({
    type: "block_set",
    block: { id: compactionBlockId, kind: "compaction", status, ...(result ? { result } : {}) },
  });

  const translate = (event: OutboundEvent): BlockOp[] => {
    switch (event.type) {
      case "block_start": {
        if (event.kind === "tool_call") {
          toolStreamIds.add(`${event.turnIndex}:${event.blockId}`);
          if (!event.callId) return [];
          return [setTool(event.callId, { name: event.name, status: "running" })];
        }
        const id = streamBlockId(attempt, event.turnIndex, event.blockId);
        streamKinds.set(id, event.kind);
        return [{ type: "block_set", block: { id, kind: event.kind, text: "" } }];
      }
      case "block_delta": {
        if (toolStreamIds.has(`${event.turnIndex}:${event.blockId}`)) return []; // raw args JSON — not rendered
        const id = streamBlockId(attempt, event.turnIndex, event.blockId);
        return [{ type: "block_delta", blockId: id, blockKind: streamKinds.get(id) ?? "text", delta: event.delta }];
      }
      case "block_end": {
        if (event.block.type === "tool_call") {
          return [setTool(event.block.id, { name: event.block.name, args: event.block.args, status: "running" })];
        }
        // Converge on the final block content (covers any missed delta).
        const id = streamBlockId(attempt, event.turnIndex, event.blockId);
        const text = event.block.type === "text" ? event.block.text : event.block.thinking;
        return [{ type: "block_set", block: { id, kind: event.block.type, text } }];
      }
      case "tool_execution_start":
        return [setTool(event.callId, { name: event.name, args: event.args, status: "running" })];
      case "tool_action_request":
        return [
          setTool(event.callId, {
            name: event.name,
            args: event.args,
            status: event.kind === "client_tool" ? "awaiting_client" : "awaiting_approval",
            approval: event.kind === "client_tool" ? undefined : { message: event.message, allowAlways: false },
            frontendMode: event.kind === "client_tool" ? "client" : undefined,
          }),
        ];
      case "tool_execution_end":
        return [setTool(event.callId, { name: event.name, status: event.isError ? "failed" : "completed", result: event.result, isError: event.isError, clearApproval: true })];
      case "issue": {
        const callId = "callId" in event.issue ? event.issue.callId : undefined;
        if (callId && toolBlocks.has(callId)) {
          const existing = toolBlocks.get(callId);
          if (existing && existing.status !== "completed" && existing.status !== "failed") {
            return [setTool(callId, { status: "failed", result: event.issue.message, isError: true, clearApproval: true })];
          }
        }
        return [];
      }
      case "compaction_start":
        return [compaction("running")];
      case "compaction_end":
        return [compaction("completed")];
      default:
        return [];
    }
  };

  return { translate, compaction };
};

// ---------------------------------------------------------------------------
// Run-config materialization
// ---------------------------------------------------------------------------

type MaterializedChatConfig = {
  actor?: RequestActor;
  systemPrompt?: string;
  resourceContext?: string;
  tools: AiRuntimeTool[];
  toolApprovalContext?: AiToolApprovalContext;
  modelPolicy: AiChatTurnRunConfig["modelPolicy"];
  requestedModelId?: string;
};

const materializeChatConfig = async (config: AiChatTurnRunConfig, signal: AbortSignal): Promise<MaterializedChatConfig> => {
  const source = config.toolSource ?? { kind: "none" };
  if (source.kind === "resource") {
    if (!config.actor) throw new Error("AI resource turn is missing an actor.");
    const resource = await resolveAiResourceRunContext({ resourceKey: source.resourceKey, params: source.params, actor: config.actor, signal });
    return {
      actor: resource.actor,
      systemPrompt: resource.systemPrompt,
      resourceContext: resource.resourceContext,
      tools: resource.tools,
      toolApprovalContext: { actorUserId: resource.ownerUserId, appId: resource.descriptor.appId, resource: resource.conversationResource },
      modelPolicy: resource.modelPolicy,
      requestedModelId: config.requestedModelId,
    };
  }
  return {
    actor: config.actor,
    systemPrompt: config.systemPrompt,
    resourceContext: config.resourceContext,
    tools: source.kind === "default" ? await createConfiguredDefaultCloudAiTools() : [],
    toolApprovalContext: config.toolApprovalContext,
    modelPolicy: config.modelPolicy,
    requestedModelId: config.requestedModelId,
  };
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

type AttemptOutcome = { kind: "finished"; status: "completed" | "failed" | "aborted"; error: string | null } | { kind: "suspended" };

export class AiTurnExecutor {
  constructor(private readonly config: ExecutorConfig) {}

  async run(input: { conversationId: string; turnId: string; claim: AiTurnClaim; signal: AbortSignal }): Promise<void> {
    const { conversationId, turnId, claim, signal } = input;
    const pipeline = new StreamPipeline({
      conversationId,
      turnId,
      attempt: claim.turn.attempt,
      startSeq: claim.liveSeq,
      leaseOwner: this.config.leaseOwner,
      seedBlocks: claim.liveBlocks ?? [],
    });
    await pipeline.emitTurnStarted(claim.turn.modelProfileId ?? "");

    const runConfig = claim.runConfig;
    if (!runConfig) {
      await this.finalize(conversationId, turnId, pipeline, "failed", "AI turn is missing its run configuration.");
      return;
    }

    if (runConfig.kind === "compact") {
      await this.runCompaction(conversationId, turnId, pipeline, runConfig, signal);
      return;
    }
    await this.runChat(conversationId, turnId, claim, runConfig, pipeline, signal);
  }

  private async finalize(
    conversationId: string,
    turnId: string,
    pipeline: StreamPipeline,
    status: "completed" | "failed" | "aborted",
    error: string | null,
  ): Promise<void> {
    if (status === "failed" && error) log.error("AI turn failed", { conversationId, turnId, error });
    const finalized = await aiConversationStore.completeTurn({ conversationId, turnId, status, error, leaseOwner: this.config.leaseOwner });
    if (finalized) await pipeline.emitTurnFinished(status, error);
    await pipeline.flush().catch(() => undefined);
  }

  private async runChat(
    conversationId: string,
    turnId: string,
    claim: AiTurnClaim,
    config: AiChatTurnRunConfig,
    pipeline: StreamPipeline,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now();
    const abortController = new AbortController();
    const onSignal = () => abortController.abort();
    if (signal.aborted) abortController.abort();
    else signal.addEventListener("abort", onSignal, { once: true });

    let material: MaterializedChatConfig;
    let validated: ValidatedTurn;
    try {
      material = await materializeChatConfig(config, abortController.signal);
      validated = await (this.config.validateTurn ?? validateAiTurnRequest)({
        input: config.input,
        modelPolicy: material.modelPolicy,
        requestedModelId: material.requestedModelId,
      });
    } catch (error) {
      signal.removeEventListener("abort", onSignal);
      await this.finalize(conversationId, turnId, pipeline, "failed", error instanceof Error ? error.message : "AI turn failed");
      return;
    }
    const { settings, resolved } = validated;

    const prepared = prepareAiTools({ tools: resolved.profile.capabilities.includes("tools") ? material.tools : [], actor: material.actor });
    const store = aiConversationStore.createSessionStore({ conversationId, modelProfileId: resolved.profile.id, turnId, leaseOwner: this.config.leaseOwner });

    const [loopMessages, pendingRecords, resolvedRecords] = await Promise.all([
      aiConversationStore.listTurnMessages({ conversationId, loopId: turnId }),
      aiConversationStore.listPendingActionRecords({ conversationId, turnId }),
      aiConversationStore.listResolvedPendingActions({ conversationId, turnId }),
    ]);
    const assistantMessages = loopMessages.filter((message) => message.message.role !== "user");
    const isFresh = assistantMessages.length === 0 && resolvedRecords.length === 0;

    // Rebuild the whole active-turn view so a re-run/continuation reconstructs it.
    pipeline.seedBaseline(rebuildBlocksFromMessages(assistantMessages, pendingRecords));
    await pipeline.emitBaseline();

    const loop = nessi({
      agentId: "cloud",
      loopId: turnId,
      ...(isFresh ? { input: config.input } : {}),
      provider: resolved.provider,
      systemPrompt: buildSystemPrompt(settings.globalInstructions, material.systemPrompt, material.resourceContext),
      store,
      tools: prepared.tools,
      maxTurns: prepared.tools.length > 0 ? 8 : 1,
      temperature: resolved.profile.temperature,
      maxOutputTokens: resolved.profile.maxOutputTokens,
      coalesce: { ms: AI_COALESCE_MS, maxChars: AI_COALESCE_MAX_CHARS },
      compact: createCloudCompactFn({
        conversationId,
        modelProfileId: resolved.profile.id,
        prompt: settings.compactionPrompt,
        maxOutputTokens: resolved.profile.maxOutputTokens,
        signal: abortController.signal,
      }),
      maxToolResultChars: settings.maxToolResultChars,
      signal: abortController.signal,
    });

    // Seed the resumed loop with resolved actions before iterating.
    for (const record of resolvedRecords) {
      if (record.resolvedEvent) loop.push(record.resolvedEvent);
    }

    const outcome = await this.driveChatLoop({ loop, pipeline, conversationId, turnId, abortController, prepared, approvalContext: material.toolApprovalContext });
    signal.removeEventListener("abort", onSignal);

    if (outcome.kind === "suspended") {
      log.info("AI turn suspended", { conversationId, turnId, attempt: claim.turn.attempt, durationMs: Date.now() - startedAt });
      await this.config.enqueueContinuation({ conversationId, turnId }).catch(() => undefined);
      await pipeline.flush().catch(() => undefined);
      return;
    }

    await this.finalize(conversationId, turnId, pipeline, outcome.status, outcome.error);
    log.info("AI turn finished", {
      conversationId,
      turnId,
      attempt: claim.turn.attempt,
      status: outcome.status,
      durationMs: Date.now() - startedAt,
      firstBlockMs: pipeline.firstBlockMs,
      wireSeq: pipeline.seq,
    });
  }

  private async driveChatLoop(input: {
    loop: NessiLoop;
    pipeline: StreamPipeline;
    conversationId: string;
    turnId: string;
    abortController: AbortController;
    prepared: PreparedAiTools;
    approvalContext?: AiToolApprovalContext;
  }): Promise<AttemptOutcome> {
    const { loop, pipeline, conversationId, turnId, abortController, prepared, approvalContext } = input;
    const stopHeartbeat = this.startHeartbeat(conversationId, turnId, abortController);
    let lastIssueMessage: string | null = null;

    try {
      for await (const event of loop) {
        if (event.type === "tool_action_request") {
          const suspended = await this.handleActionRequest({ event, loop, pipeline, conversationId, turnId, prepared, approvalContext });
          if (suspended) {
            abortController.abort();
            loop.abort();
            return { kind: "suspended" };
          }
          continue;
        }

        await pipeline.apply(event);

        if (event.type === "tool_execution_start") {
          await aiToolAudit
            .noteToolCall({ conversationId, turnId, callId: event.callId, toolName: event.name, location: prepared.frontendModes.get(event.name) ?? "server", args: event.args })
            .catch(() => undefined);
        } else if (event.type === "tool_execution_end") {
          await aiToolAudit.noteToolCompleted({ turnId, callId: event.callId, result: event.result, isError: event.isError }).catch(() => undefined);
        } else if (event.type === "issue") {
          lastIssueMessage = event.issue.message;
          log.warn("AI turn issue", { conversationId, turnId, kind: event.issue.kind, message: event.issue.message });
        } else if (event.type === "loop_end") {
          const aggregate = event.aggregate;
          if (aggregate.assistantMessageCount > 0) {
            await aiConversationStore
              .setLatestAssistantLoopAggregate({ conversationId, loopId: turnId, aggregate, doneReason: event.reason })
              .catch(() => undefined);
          }
          if (event.reason === "aborted") return { kind: "finished", status: "aborted", error: null };
          if (event.reason === "stop" || event.reason === "max_turns") return { kind: "finished", status: "completed", error: null };
          return { kind: "finished", status: "failed", error: lastIssueMessage ?? `AI turn ended: ${event.reason}` };
        }
      }
      return { kind: "finished", status: abortController.signal.aborted ? "aborted" : "completed", error: null };
    } catch (error) {
      if (abortController.signal.aborted) return { kind: "finished", status: "aborted", error: null };
      const message = error instanceof Error ? error.message : "AI turn failed";
      await pipeline.emitError(message).catch(() => undefined);
      return { kind: "finished", status: "failed", error: message };
    } finally {
      stopHeartbeat();
      await pipeline.flush().catch(() => undefined);
    }
  }

  /** Returns true when the turn was suspended for the action; false when resolved inline. */
  private async handleActionRequest(input: {
    event: Extract<OutboundEvent, { type: "tool_action_request" }>;
    loop: NessiLoop;
    pipeline: StreamPipeline;
    conversationId: string;
    turnId: string;
    prepared: PreparedAiTools;
    approvalContext?: AiToolApprovalContext;
  }): Promise<boolean> {
    const { event, loop, pipeline, conversationId, turnId, prepared, approvalContext } = input;
    const approvalPolicy = prepared.approvalPolicies.get(event.name);
    const frontendMode: AiFrontendToolMode | undefined = event.kind === "client_tool" ? (prepared.frontendModes.get(event.name) ?? "client") : undefined;
    const approvalScope = aiToolApprovalScope(event.name, approvalPolicy);
    const allowAlways = aiToolAllowsAlways(approvalPolicy);

    // Display-only client_view tools (e.g. cards) never need user input — resolve
    // inline and keep streaming instead of taking a full suspend/continuation trip.
    if (frontendMode === "client_view") {
      await pipeline.apply(event);
      loop.push({ type: "tool_result", callId: event.callId, result: { displayed: true } });
      await aiToolAudit.noteToolCompleted({ turnId, callId: event.callId, result: { displayed: true }, isError: false }).catch(() => undefined);
      return false;
    }

    // Remembered approvals resolve inline too.
    if (event.kind !== "client_tool" && allowAlways && approvalContext) {
      const remembered = await hasRememberedAiToolApproval(approvalContext, { toolName: event.name, approvalScope }).catch(() => false);
      if (remembered) {
        await aiToolAudit.noteApprovalResolved({ turnId, callId: event.callId, approvalState: "approved_by_preference" }).catch(() => undefined);
        loop.push({ type: "approval_response", callId: event.callId, approved: true });
        return false;
      }
    }

    await aiConversationStore.savePendingTurnAction({
      turnId,
      conversationId,
      callId: event.callId,
      kind: event.kind,
      status: "pending",
      name: event.name,
      args: event.args,
      message: event.message,
      approvalScope,
      allowAlways,
      frontendMode,
      resolvedEvent: null,
    });

    if (event.kind === "client_tool") {
      await aiToolAudit
        .noteToolCall({ conversationId, turnId, callId: event.callId, toolName: event.name, location: frontendMode ?? "client", args: event.args, status: "waiting_for_frontend" })
        .catch(() => undefined);
    } else {
      await aiToolAudit
        .noteApprovalRequested({ conversationId, turnId, callId: event.callId, toolName: event.name, location: "server", args: event.args })
        .catch(() => undefined);
    }

    await pipeline.apply(event);
    const suspended = await aiConversationStore.suspendTurn({
      conversationId,
      turnId,
      leaseOwner: this.config.leaseOwner,
      blocks: pipeline.blocks,
      seq: pipeline.seq,
      waitingBudgetMs: AI_ACTION_BUDGET_MS,
    });
    await pipeline.flush().catch(() => undefined);
    return suspended;
  }

  private startHeartbeat(conversationId: string, turnId: string, abortController: AbortController): () => void {
    let stopped = false;
    let failures = 0;
    const tick = async () => {
      if (stopped) return;
      let ok = false;
      try {
        ok = await aiConversationStore.heartbeatTurn({ conversationId, turnId, leaseOwner: this.config.leaseOwner, leaseMs: AI_TURN_LEASE_MS });
        failures = 0;
      } catch {
        failures += 1;
        if (failures < 3) return;
      }
      if (!ok && !stopped) abortController.abort();
    };
    const timer = setInterval(() => void tick(), this.config.heartbeatMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  private async runCompaction(
    conversationId: string,
    turnId: string,
    pipeline: StreamPipeline,
    config: Extract<AiTurnRunConfig, { kind: "compact" }>,
    signal: AbortSignal,
  ): Promise<void> {
    const abortController = new AbortController();
    const onSignal = () => abortController.abort();
    if (signal.aborted) abortController.abort();
    else signal.addEventListener("abort", onSignal, { once: true });

    let validated: ValidatedTurn;
    try {
      validated = await (this.config.validateTurn ?? validateAiTurnRequest)({
        input: "",
        modelPolicy: config.modelPolicy,
        requestedModelId: config.requestedModelId,
      });
    } catch (error) {
      signal.removeEventListener("abort", onSignal);
      await this.finalize(conversationId, turnId, pipeline, "failed", error instanceof Error ? error.message : "AI compaction failed");
      return;
    }
    const { settings, resolved } = validated;

    const store = aiConversationStore.createSessionStore({ conversationId, modelProfileId: resolved.profile.id, turnId, leaseOwner: this.config.leaseOwner });
    const loop = compact({
      agentId: "cloud",
      loopId: turnId,
      store,
      provider: resolved.provider,
      force: true,
      signal: abortController.signal,
      compact: createCloudCompactFn({
        conversationId,
        modelProfileId: resolved.profile.id,
        prompt: settings.compactionPrompt,
        maxOutputTokens: resolved.profile.maxOutputTokens,
        signal: abortController.signal,
      }),
    });

    const stopHeartbeat = this.startHeartbeat(conversationId, turnId, abortController);
    let status: "completed" | "failed" | "aborted" = "failed";
    let error: string | null = null;
    try {
      for await (const event of loop as AsyncIterable<CompactEvent>) {
        if (event.type === "compaction_start") await pipeline.applyCompaction("running");
        else if (event.type === "compaction_end") await pipeline.applyCompaction("completed");
        else if (event.type === "issue") error = event.issue.message;
        else if (event.type === "loop_end") {
          status = event.reason === "stop" ? "completed" : event.reason === "aborted" ? "aborted" : "failed";
          await pipeline.applyCompaction(status === "failed" ? "failed" : "completed", event.result);
        }
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        status = "aborted";
      } else {
        status = "failed";
        error = err instanceof Error ? err.message : "AI compaction failed";
        await pipeline.emitError(error).catch(() => undefined);
      }
    } finally {
      stopHeartbeat();
      signal.removeEventListener("abort", onSignal);
    }

    await this.finalize(conversationId, turnId, pipeline, status, error);
  }
}

// ---------------------------------------------------------------------------
// Stream pipeline — seq allocation, ordered publish + snapshot throttle
// ---------------------------------------------------------------------------

class StreamPipeline {
  blocks: AiTurnBlock[];
  seq: number;
  /** Wall-clock ms from construction to the first streamed block op (provider TTFB proxy). */
  firstBlockMs: number | null = null;
  private readonly createdAt = Date.now();
  private readonly conversationId: string;
  private readonly turnId: string;
  private readonly attempt: number;
  private readonly leaseOwner: string;
  private readonly mapper: ReturnType<typeof createEventMapper>;
  private lastSnapshotAt = 0;
  private snapshotDirty = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(input: { conversationId: string; turnId: string; attempt: number; startSeq: number; leaseOwner: string; seedBlocks: AiTurnBlock[] }) {
    this.conversationId = input.conversationId;
    this.turnId = input.turnId;
    this.attempt = input.attempt;
    this.leaseOwner = input.leaseOwner;
    this.seq = input.startSeq;
    this.blocks = [];
    this.mapper = createEventMapper(input.attempt, input.seedBlocks);
  }

  private ordered(run: () => Promise<void>): Promise<void> {
    this.chain = this.chain.catch(() => undefined).then(run);
    return this.chain;
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private envelope<T extends { type: string }>(event: T): T & { v: 1; conversationId: string; turnId: string; attempt: number } {
    return { ...event, v: 1, conversationId: this.conversationId, turnId: this.turnId, attempt: this.attempt };
  }

  seedBaseline(blocks: AiTurnBlock[]): void {
    this.blocks = blocks;
  }

  async emitBaseline(): Promise<void> {
    for (const block of this.blocks) {
      const seq = this.nextSeq();
      await this.publish(this.envelope({ type: "block_set" as const, seq, block }) as AiWireEvent);
    }
    this.snapshotDirty = this.blocks.length > 0;
  }

  async emitTurnStarted(modelProfileId: string): Promise<void> {
    const seq = this.nextSeq();
    await this.publish(this.envelope({ type: "turn_started" as const, seq, modelProfileId, providerModel: "" }) as AiWireEvent);
  }

  async apply(event: OutboundEvent): Promise<void> {
    const ops = this.mapper.translate(event);
    if (ops.length > 0 && this.firstBlockMs === null) this.firstBlockMs = Date.now() - this.createdAt;
    for (const op of ops) await this.emitOp(op);
    await this.maybeSnapshot();
  }

  async applyCompaction(status: "running" | "completed" | "failed", result?: Extract<AiTurnBlock, { kind: "compaction" }>["result"]): Promise<void> {
    await this.emitOp(this.mapper.compaction(status, result));
    await this.maybeSnapshot();
  }

  private async emitOp(op: { type: "block_set"; block: AiTurnBlock } | { type: "block_delta"; blockId: string; blockKind: "text" | "thinking"; delta: string }): Promise<void> {
    const seq = this.nextSeq();
    const event = this.envelope({ ...op, seq }) as AiWireEvent;
    this.blocks = applyWireEventToBlocks(this.blocks, event);
    this.snapshotDirty = true;
    await this.publish(event);
  }

  private async maybeSnapshot(): Promise<void> {
    if (!this.snapshotDirty) return;
    if (Date.now() - this.lastSnapshotAt < AI_SNAPSHOT_INTERVAL_MS) return;
    await this.persistSnapshot();
  }

  async persistSnapshot(): Promise<void> {
    this.lastSnapshotAt = Date.now();
    this.snapshotDirty = false;
    await aiConversationStore
      .saveTurnLiveState({ conversationId: this.conversationId, turnId: this.turnId, leaseOwner: this.leaseOwner, blocks: this.blocks, seq: this.seq })
      .catch(() => undefined);
  }

  async emitError(message: string): Promise<void> {
    const seq = this.nextSeq();
    const block: AiTurnBlock = { id: `error-${this.attempt}-${seq}`, kind: "text", text: `⚠️ ${message}` };
    const event = this.envelope({ type: "block_set" as const, seq, block }) as AiWireEvent;
    this.blocks = applyWireEventToBlocks(this.blocks, event);
    await this.publish(event);
  }

  async emitTurnFinished(status: "completed" | "failed" | "aborted", error: string | null): Promise<void> {
    const seq = this.nextSeq();
    await this.publish(this.envelope({ type: "turn_finished" as const, seq, status, error }) as AiWireEvent);
  }

  private publish(event: AiWireEvent): Promise<void> {
    return this.ordered(() => publishAiWireEvent(event).catch(() => undefined));
  }

  async flush(): Promise<void> {
    await this.chain;
  }
}

export const __aiExecutorTest = { createEventMapper, rebuildBlocksFromMessages };
