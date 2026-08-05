import { isDeepStrictEqual } from "node:util";
import type { InboundEvent, Input, Message } from "@k2b/nessi";
import { type QueueReceived, queue } from "@k2b/sync";
import { z } from "zod";
import type { RequestActor } from "../server";
import { logger } from "../services/logging";
import { superviseRuntimeTask } from "../services/runtime-lifecycle";
import { type AiToolApprovalContext, rememberAiToolApproval } from "./approvals";
import { AiTurnExecutor } from "./executor";
import { aiConversationStore } from "./store";
import { publishAiTurnAbort, publishAiWireEvent } from "./stream";
import { aiToolAudit } from "./tool-audit";
import type {
  AiChatTurnRunConfig,
  AiClientToolId,
  AiCompactionTurnRunConfig,
  AiModelPolicy,
  AiPendingTurnAction,
  AiStoredMessage,
  AiTurn,
  AiTurnFinalizedAction,
  AiTurnFinalizedEvent,
  AiTurnToolSource,
} from "./types";
import { validateAiTurnRequest } from "./validate";

export type { ValidateAiTurnInput } from "./validate";
export { isAiSettingsError, validateAiTurnRequest } from "./validate";

const log = logger("ai:runtime");

const AI_WORKER_ID = `worker-${crypto.randomUUID()}`;
const AI_TURN_LEASE_MS = 45_000;
const AI_TURN_HEARTBEAT_MS = 3_000;
const AI_TURN_WORKER_CONCURRENCY = 8;
const AI_TURN_MAX_ATTEMPTS = 5;
const AI_TURN_RUN_BUDGET_MS = 10 * 60_000;
const AI_SWEEP_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

type AiTurnJob = { conversationId: string; turnId: string };

const aiTurnQueue = queue<AiTurnJob>({
  id: "cloud-ai-turns",
  delivery: { defaultLeaseMs: AI_TURN_LEASE_MS, maxDeliveries: 50 },
});

// No idempotency key: the DB claim is the only gate, so re-enqueues (recovery,
// continuation, stale-sweep) are always allowed and never silently swallowed.
const enqueueAiTurn = (job: AiTurnJob): Promise<unknown> => aiTurnQueue.send({ data: job, orderingKey: job.conversationId });

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export type SubmitAiChatTurnInput = {
  conversationId: string;
  input: Input;
  userMessage: Message;
  actor?: RequestActor;
  modelPolicy?: AiModelPolicy;
  requestedModelId?: string;
  systemPrompt?: string;
  resourceContext?: string;
  skill?: AiChatTurnRunConfig["skill"];
  clientToolIds?: AiClientToolId[];
  toolSource?: AiTurnToolSource;
  toolApprovalContext?: AiToolApprovalContext;
  /** Retry-in-place: drop active messages with seq >= this before creating the turn. */
  truncateFromSeq?: number;
};

export const submitAiChatTurn = async (input: SubmitAiChatTurnInput): Promise<{ turn: AiTurn; message: AiStoredMessage }> => {
  if (input.clientToolIds?.length && input.toolSource?.kind !== "default") {
    throw new Error("Optional client tools require the default tool source.");
  }
  const { resolved } = await validateAiTurnRequest({
    input: input.input,
    modelPolicy: input.modelPolicy,
    requestedModelId: input.requestedModelId,
  });
  const runConfig: AiChatTurnRunConfig = {
    kind: "chat",
    input: input.input,
    actor: input.actor,
    modelPolicy: input.modelPolicy,
    requestedModelId: input.requestedModelId,
    systemPrompt: input.systemPrompt,
    resourceContext: input.resourceContext,
    skill: input.skill,
    clientToolIds: input.clientToolIds,
    toolSource: input.toolSource ?? { kind: "none" },
    toolApprovalContext: input.toolApprovalContext,
  };

  const submitted = await aiConversationStore.submitChatTurn({
    conversationId: input.conversationId,
    modelProfileId: resolved.profile.id,
    runConfig,
    userMessage: input.userMessage,
    truncateFromSeq: input.truncateFromSeq,
  });

  await enqueueAiTurn({ conversationId: input.conversationId, turnId: submitted.turn.id });
  return submitted;
};

export type SubmitAiCompactionInput = {
  conversationId: string;
  actor?: RequestActor;
  modelPolicy?: AiModelPolicy;
  requestedModelId?: string;
};

export const submitAiCompaction = async (input: SubmitAiCompactionInput): Promise<{ turn: AiTurn }> => {
  const { resolved } = await validateAiTurnRequest({ input: "", modelPolicy: input.modelPolicy, requestedModelId: input.requestedModelId });
  const runConfig: AiCompactionTurnRunConfig = {
    kind: "compact",
    actor: input.actor,
    modelPolicy: input.modelPolicy,
    requestedModelId: input.requestedModelId,
  };
  const turn = await aiConversationStore.createTurn({
    conversationId: input.conversationId,
    modelProfileId: resolved.profile.id,
    runConfig,
  });
  await enqueueAiTurn({ conversationId: input.conversationId, turnId: turn.id });
  return { turn };
};

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

export const abortAiTurn = async (input: { conversationId: string; turnId: string }): Promise<{ ok: true }> => {
  // Capture the wire coordinates before finalization so we can emit turn_finished.
  const active = await aiConversationStore.getActiveTurn({ conversationId: input.conversationId }).catch(() => null);
  const request = await aiConversationStore.requestTurnAbort({ ...input, reason: "user" });
  if (!request.found) return { ok: true };

  // Tell any live owner to stop (its heartbeat also detects the cancel flag).
  await publishAiTurnAbort(input).catch(() => undefined);

  if (request.ownerless) {
    const finalized = await aiConversationStore.completeTurn({ ...input, status: "aborted", error: null });
    if (finalized === "completed") {
      const attempt = active?.turn.id === input.turnId ? active.turn.attempt : 1;
      const seq = (active?.turn.id === input.turnId ? active.liveSeq : 0) + 1;
      await publishAiWireEvent({
        v: 1,
        conversationId: input.conversationId,
        turnId: input.turnId,
        attempt,
        seq,
        type: "turn_finished",
        status: "aborted",
        error: null,
      }).catch(() => undefined);
    }
  }
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Actions (approvals + frontend tool results)
// ---------------------------------------------------------------------------

export const AiTurnActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approval_response"), approved: z.boolean(), remember: z.literal("always").optional() }),
  z.object({ type: z.literal("tool_result"), result: z.unknown() }),
]);
export type AiTurnActionInput = z.infer<typeof AiTurnActionSchema>;

const actionMatchesResolvedEvent = (action: AiTurnActionInput, event: InboundEvent | null, callId: string): boolean => {
  if (!event || event.callId !== callId) return false;
  if (action.type === "approval_response") return event.type === "approval_response" && event.approved === action.approved;
  return event.type === "tool_result" && isDeepStrictEqual(event.result, action.result);
};

export const listPendingAiTurnActions = (input: { conversationId: string; turnId: string }): Promise<AiPendingTurnAction[]> =>
  aiConversationStore.listPendingTurnActions(input);

export const submitAiTurnAction = async (input: {
  conversationId: string;
  turnId: string;
  callId: string;
  action: AiTurnActionInput;
  toolApprovalContext?: AiToolApprovalContext;
}): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; message: string }> => {
  const pending = await aiConversationStore.getPendingTurnAction(input);
  if (!pending) return { ok: false, status: 404, message: "This request has expired — the assistant already moved on." };
  if (pending.status === "resolved") {
    if (!actionMatchesResolvedEvent(input.action, pending.resolvedEvent, input.callId)) {
      return { ok: false, status: 409, message: "AI action was already resolved with a different response." };
    }
    // Idempotent retry: ensure a continuation is queued and return success.
    await enqueueAiTurn({ conversationId: input.conversationId, turnId: input.turnId }).catch(() => undefined);
    return { ok: true };
  }
  if (pending.status !== "pending") {
    return { ok: false, status: 404, message: "This request has expired — the assistant already moved on." };
  }

  if (input.action.type === "approval_response") {
    if (pending.kind === "client_tool") return { ok: false, status: 400, message: "Frontend tool requests require a tool result." };

    if (input.action.approved && input.action.remember === "always" && pending.allowAlways && input.toolApprovalContext) {
      await rememberAiToolApproval(input.toolApprovalContext, { toolName: pending.name, approvalScope: pending.approvalScope }).catch(
        () => undefined,
      );
    }
    await aiToolAudit
      .noteApprovalResolved({
        turnId: input.turnId,
        callId: input.callId,
        approvalState: input.action.approved ? (input.action.remember === "always" ? "approved_always" : "approved_once") : "rejected",
      })
      .catch(() => undefined);

    const resolved = await aiConversationStore.resolvePendingTurnAction({
      ...input,
      event: { type: "approval_response", callId: input.callId, approved: input.action.approved },
    });
    if (!resolved) {
      const raced = await aiConversationStore.getPendingTurnAction(input);
      if (!raced || !actionMatchesResolvedEvent(input.action, raced.resolvedEvent, input.callId)) {
        return { ok: false, status: 409, message: "AI action was already resolved with a different response." };
      }
    }
  } else {
    if (pending.kind !== "client_tool") return { ok: false, status: 400, message: "Approval requests require an approval response." };
    const resolved = await aiConversationStore.resolvePendingTurnAction({
      ...input,
      event: { type: "tool_result", callId: input.callId, result: input.action.result },
    });
    if (!resolved) {
      const raced = await aiConversationStore.getPendingTurnAction(input);
      if (!raced || !actionMatchesResolvedEvent(input.action, raced.resolvedEvent, input.callId)) {
        return { ok: false, status: 409, message: "AI action was already resolved with a different response." };
      }
    }
    await aiToolAudit
      .noteToolCompleted({ turnId: input.turnId, callId: input.callId, result: input.action.result, isError: false })
      .catch(() => undefined);
  }

  await enqueueAiTurn({ conversationId: input.conversationId, turnId: input.turnId });
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Worker + sweep lifecycle
// ---------------------------------------------------------------------------

const runClaimedTurn = async (
  job: AiTurnJob,
  signal: AbortSignal,
  leaseOwner: string,
  onTurnFinalized?: (event: AiTurnFinalizedEvent) => Promise<void>,
): Promise<void> => {
  const claim =
    (await aiConversationStore.claimTurn({
      ...job,
      leaseOwner,
      leaseMs: AI_TURN_LEASE_MS,
      from: "queue",
      maxAttempts: AI_TURN_MAX_ATTEMPTS,
      runBudgetMs: AI_TURN_RUN_BUDGET_MS,
    })) ??
    (await aiConversationStore.claimTurn({
      ...job,
      leaseOwner,
      leaseMs: AI_TURN_LEASE_MS,
      from: "waiting",
      maxAttempts: AI_TURN_MAX_ATTEMPTS,
      runBudgetMs: AI_TURN_RUN_BUDGET_MS,
    }));

  if (!claim) return; // Already owned, done, cancelled, or attempt-capped.

  const executor = new AiTurnExecutor({
    leaseOwner,
    heartbeatMs: AI_TURN_HEARTBEAT_MS,
    enqueueContinuation: (input) => enqueueAiTurn(input).then(() => undefined),
    onTurnFinalized,
  });
  await executor.run({ conversationId: job.conversationId, turnId: job.turnId, claim, signal });
};

const processMessage = async (
  message: QueueReceived<AiTurnJob>,
  signal: AbortSignal,
  onTurnFinalized?: (event: AiTurnFinalizedEvent) => Promise<void>,
): Promise<void> => {
  const leaseOwner = `${AI_WORKER_ID}:${message.deliveryId}`;
  const touch = setInterval(() => void message.touch({ leaseMs: AI_TURN_LEASE_MS }).catch(() => undefined), AI_TURN_HEARTBEAT_MS);
  if (typeof touch === "object" && "unref" in touch) touch.unref();
  try {
    await runClaimedTurn(message.data, signal, leaseOwner, onTurnFinalized);
  } catch (error) {
    log.error("AI turn worker error", {
      conversationId: message.data.conversationId,
      turnId: message.data.turnId,
      error: error instanceof Error ? error.message : "AI turn worker failed",
    });
  } finally {
    clearInterval(touch);
    await message.ack().catch(() => undefined);
  }
};

const publishSweepFinished = async (turn: AiTurnFinalizedAction & { error?: string }, status: "failed" | "aborted"): Promise<void> => {
  await publishAiWireEvent({
    v: 1,
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    attempt: turn.attempt,
    seq: turn.seq,
    type: "turn_finished",
    status,
    error: status === "failed" ? (turn.error ?? "AI turn failed.") : null,
  }).catch(() => undefined);
};

export const sweepAiRuntime = async (): Promise<void> => {
  const sweep = await aiConversationStore.sweepTurns({ maxAttempts: AI_TURN_MAX_ATTEMPTS });
  await Promise.all([
    ...sweep.requeued.map((job) => enqueueAiTurn(job).catch(() => undefined)),
    ...sweep.failed.map((turn) => publishSweepFinished(turn, "failed")),
    ...sweep.aborted.map((turn) => publishSweepFinished(turn, "aborted")),
  ]);
  if (sweep.requeued.length || sweep.failed.length || sweep.aborted.length) {
    log.info("AI runtime sweep", { requeued: sweep.requeued.length, failed: sweep.failed.length, aborted: sweep.aborted.length });
  }
};

type AiRuntimeState = {
  listeners: Set<(event: AiTurnFinalizedEvent) => Promise<void>>;
  stop: () => void;
};

let running: AiRuntimeState | null = null;
let refCount = 0;

export const startAiRuntime = (
  input: { concurrency?: number; onTurnFinalized?: (event: AiTurnFinalizedEvent) => Promise<void> } = {},
): (() => void) => {
  const listener = input.onTurnFinalized ? (event: AiTurnFinalizedEvent) => input.onTurnFinalized!(event) : null;
  if (running) {
    refCount += 1;
    if (listener) running.listeners.add(listener);
    return releaseAiRuntime(listener);
  }

  const concurrency = Math.min(Math.max(Math.floor(input.concurrency ?? AI_TURN_WORKER_CONCURRENCY), 1), 64);
  const controller = new AbortController();
  const listeners = new Set<(event: AiTurnFinalizedEvent) => Promise<void>>();
  if (listener) listeners.add(listener);
  refCount = 1;
  const dispatchTurnFinalized = async (event: AiTurnFinalizedEvent): Promise<void> => {
    const results = await Promise.allSettled([...listeners].map((notify) => notify(event)));
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, `${errors.length} AI turn finalized listener(s) failed`);
  };

  for (let index = 0; index < concurrency; index += 1) {
    const consumerId = `${AI_WORKER_ID}:${index}`;
    void superviseRuntimeTask({
      name: `AI turn reader ${consumerId}`,
      signal: controller.signal,
      run: async (signal) => {
        const reader = aiTurnQueue.reader();
        for await (const message of reader.stream({ wait: true, leaseMs: AI_TURN_LEASE_MS, consumerId, signal })) {
          if (signal.aborted) {
            await message.nack({ delayMs: 1_000, reason: "worker_stopped" }).catch(() => undefined);
            continue;
          }
          await processMessage(message, signal, dispatchTurnFinalized);
        }
      },
      onError: ({ error, failureCount, retryInMs }) =>
        log.error("AI turn reader stopped; restarting", {
          consumerId,
          error: error instanceof Error ? error.message : "AI turn worker failed",
          failureCount,
          retryInMs,
        }),
    });
  }

  const runSweep = () =>
    void sweepAiRuntime().catch((error) =>
      log.warn("AI runtime sweep failed", { error: error instanceof Error ? error.message : "sweep failed" }),
    );
  runSweep();
  const sweepTimer = setInterval(runSweep, AI_SWEEP_INTERVAL_MS);
  if (typeof sweepTimer === "object" && "unref" in sweepTimer) sweepTimer.unref();

  const state: AiRuntimeState = {
    listeners,
    stop: () => {
      if (running !== state) return;
      controller.abort();
      clearInterval(sweepTimer);
      listeners.clear();
      running = null;
      refCount = 0;
    },
  };
  running = state;
  log.info("AI runtime started", { workerId: AI_WORKER_ID, concurrency });
  return releaseAiRuntime(listener);
};

const releaseAiRuntime = (listener: ((event: AiTurnFinalizedEvent) => Promise<void>) | null): (() => void) => {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const state = running;
    if (!state) return;
    if (listener) state.listeners.delete(listener);
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) state.stop();
  };
};

export const __aiRuntimeTest = { actionMatchesResolvedEvent };

/** @deprecated Compatibility shim for the previous recovery API; use startAiRuntime. */
export const startAiRuntimeRecovery = startAiRuntime;
