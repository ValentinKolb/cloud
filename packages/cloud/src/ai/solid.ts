import type { Accessor } from "solid-js";
import { createSignal, onCleanup } from "solid-js";
import { parseAiSse, readAiError } from "./browser";
import type { AiMessageRetryMode } from "./http";
import type { AiConversation, AiPendingTurnAction, AiSseEvent, AiStoredMessage, AiTurn, AiUiBlock, AiUserContentPart } from "./types";

type ActiveTurn = {
  conversationId: string;
  turnId: string;
  loopId?: string;
  cursor?: string;
};

type ApprovalRequest = Extract<AiSseEvent, { type: "approval_request" }>;
type FrontendToolRequest = Extract<AiSseEvent, { type: "frontend_tool" }>;
type DoneEvent = Extract<AiSseEvent, { type: "done" }>;

const eventLoopId = (event: AiSseEvent): string =>
  event.loopId ?? (event.type === "nessi" ? event.event.loopId : undefined) ?? event.turnId;

export type AiApprovalRequest = ApprovalRequest;
export type AiFrontendToolRequest = FrontendToolRequest;
export type AiFrontendToolHandler = (request: AiFrontendToolRequest) => unknown | Promise<unknown>;
export type AiChatRunStatus = "idle" | "sending" | "streaming" | "waiting_for_action" | "reconnecting" | "stopping" | "failed";

type TurnActionInput =
  | {
      type: "approval_response";
      approved: boolean;
      remember?: "always";
    }
  | {
      type: "tool_result";
      result: unknown;
    };

type AiConversationDetail = {
  conversation: AiConversation;
  messages: AiStoredMessage[];
  activeTurn: AiTurn | null;
  pendingActions?: AiPendingTurnAction[];
};

type AiChatRouteBranch = {
  conversations: {
    $get: (...args: any[]) => Promise<Response>;
    $post: (...args: any[]) => Promise<Response>;
    ":conversationId": {
      $get: (...args: any[]) => Promise<Response>;
      messages: {
        ":messageId": {
          fork: {
            $post: (...args: any[]) => Promise<Response>;
          };
          retry: {
            $post: (...args: any[]) => Promise<Response>;
          };
        };
      };
      compact?: {
        $post: (...args: any[]) => Promise<Response>;
      };
      turns: {
        $post: (...args: any[]) => Promise<Response>;
        ":turnId": {
          abort: {
            $post: (...args: any[]) => Promise<Response>;
          };
          actions: {
            ":callId": {
              $post: (...args: any[]) => Promise<Response>;
            };
          };
          events: {
            $get: (...args: any[]) => Promise<Response>;
          };
        };
      };
    };
  };
};

type CreateAiChatControllerOptions<TRoute extends AiChatRouteBranch> = {
  route: TRoute;
  params?: Record<string, string> | Accessor<Record<string, string>>;
  initialConversations?: AiConversation[];
  initialConversationId?: string | null;
  initialMessages?: AiStoredMessage[];
  initialActiveTurn?: AiTurn | null;
  initialPendingActions?: AiPendingTurnAction[];
  initialError?: string | null;
  autoResume?: boolean;
  frontendTools?: Record<string, AiFrontendToolHandler>;
};

const tempUserMessage = (conversationId: string, content: AiUserContentPart[]): AiStoredMessage => ({
  id: `tmp-user-${Date.now()}`,
  conversationId,
  seq: Date.now(),
  kind: "message",
  message: { role: "user", content },
  modelProfileId: null,
  providerModel: null,
  usage: null,
  stopReason: null,
  loopId: null,
  loopAggregate: null,
  loopDoneReason: null,
  createdAt: new Date().toISOString(),
});

const tempAssistantMessage = (
  conversationId: string,
  message: AiStoredMessage["message"],
  metadata: Partial<Pick<AiStoredMessage, "loopId" | "loopAggregate" | "loopDoneReason" | "usage">> = {},
): AiStoredMessage => ({
  id: `tmp-assistant-${Date.now()}`,
  conversationId,
  seq: Date.now(),
  kind: "message",
  message,
  modelProfileId: null,
  providerModel: null,
  usage: metadata.usage ?? null,
  stopReason: null,
  loopId: metadata.loopId ?? null,
  loopAggregate: metadata.loopAggregate ?? null,
  loopDoneReason: metadata.loopDoneReason ?? null,
  createdAt: new Date().toISOString(),
});

const isAccessor = <T>(value: T | Accessor<T>): value is Accessor<T> => typeof value === "function";

const isApprovalRequest = (action: AiPendingTurnAction): action is ApprovalRequest => action.type === "approval_request";

const isFrontendToolRequest = (action: AiPendingTurnAction): action is FrontendToolRequest => action.type === "frontend_tool";

const pendingActionToUiBlock = (action: AiPendingTurnAction): AiUiBlock =>
  action.type === "approval_request"
    ? { id: `approval-${eventLoopId(action)}-${action.callId}`, type: "approval_request", request: action, status: "pending" }
    : { id: `frontend-${eventLoopId(action)}-${action.callId}`, type: "frontend_tool", request: action, status: "pending" };

const ASSISTANT_DRAFT_CHARS_PER_TICK = 8;
const ASSISTANT_DRAFT_TICK_MS = 32;
const ASSISTANT_DRAFT_MAX_DRAIN_MS = 3_000;

type PendingAssistantFinal = {
  conversationId: string;
  message: AiStoredMessage["message"];
  loopId: string | null;
  loopAggregate: DoneEvent["aggregate"];
  loopDoneReason: DoneEvent["reason"] | null;
};

type AiConversationSession = {
  conversationId: string;
  messages: AiStoredMessage[];
  assistantDraft: string;
  assistantThinkingDraft: string;
  assistantBlocks: AiUiBlock[];
  runStatus: AiChatRunStatus;
  error: string | null;
  approvalRequests: ApprovalRequest[];
  frontendToolRequests: FrontendToolRequest[];
  activeTurn: ActiveTurn | null;
  abortController: AbortController | null;
  resumedTurnId: string | null;
  resumeRetryTimer: ReturnType<typeof setTimeout> | null;
  resumeRetryDelayMs: number;
  assistantDeltaQueue: string;
  assistantDeltaTimer: ReturnType<typeof setTimeout> | null;
  assistantDeltaDrainStartedAt: number | null;
  pendingAssistantFinal: PendingAssistantFinal | null;
  assistantOutputWaiters: Array<() => void>;
  streamRunId: number;
  uiBlockId: number;
  handledFrontendToolCallIds: Set<string>;
};

const createEmptySession = (conversationId: string): AiConversationSession => ({
  conversationId,
  messages: [],
  assistantDraft: "",
  assistantThinkingDraft: "",
  assistantBlocks: [],
  runStatus: "idle",
  error: null,
  approvalRequests: [],
  frontendToolRequests: [],
  activeTurn: null,
  abortController: null,
  resumedTurnId: null,
  resumeRetryTimer: null,
  resumeRetryDelayMs: 1_000,
  assistantDeltaQueue: "",
  assistantDeltaTimer: null,
  assistantDeltaDrainStartedAt: null,
  pendingAssistantFinal: null,
  assistantOutputWaiters: [],
  streamRunId: 0,
  uiBlockId: 0,
  handledFrontendToolCallIds: new Set(),
});

const isRunningStatus = (status: AiChatRunStatus): boolean =>
  status === "sending" || status === "streaming" || status === "waiting_for_action" || status === "reconnecting" || status === "stopping";

export const createAiChatController = <TRoute extends AiChatRouteBranch>(options: CreateAiChatControllerOptions<TRoute>) => {
  const [conversations, setConversations] = createSignal(options.initialConversations ?? []);
  const [activeConversationId, setActiveConversationIdSignal] = createSignal<string | null>(options.initialConversationId ?? null);
  const [sessionRevision, setSessionRevision] = createSignal(0);
  const [globalError, setGlobalError] = createSignal<string | null>(options.initialError ?? null);
  const sessions = new Map<string, AiConversationSession>();

  const touchSessions = () => setSessionRevision((revision) => revision + 1);

  const ensureSession = (conversationId: string): AiConversationSession => {
    const existing = sessions.get(conversationId);
    if (existing) return existing;
    const session = createEmptySession(conversationId);
    sessions.set(conversationId, session);
    return session;
  };

  if (options.initialConversationId) {
    const session = ensureSession(options.initialConversationId);
    session.messages = options.initialMessages ?? [];
    session.activeTurn = options.initialActiveTurn
      ? { conversationId: options.initialConversationId, turnId: options.initialActiveTurn.id, loopId: options.initialActiveTurn.id }
      : null;
    session.approvalRequests = (options.initialPendingActions ?? []).filter(isApprovalRequest);
    session.frontendToolRequests = (options.initialPendingActions ?? []).filter(isFrontendToolRequest);
    session.assistantBlocks = (options.initialPendingActions ?? []).map(pendingActionToUiBlock);
    session.runStatus = options.initialPendingActions?.length ? "waiting_for_action" : "idle";
  }

  const currentParams = () => {
    const value = options.params ? (isAccessor(options.params) ? options.params() : options.params) : {};
    return { ...value };
  };

  const inputWithParams = <T extends Record<string, unknown>>(input: T = {} as T): T | (T & { param: Record<string, string> }) => {
    const params = currentParams();
    return Object.keys(params).length > 0
      ? { ...input, param: { ...params, ...(input.param as Record<string, string> | undefined) } }
      : input;
  };

  const activeSession = () => {
    sessionRevision();
    const conversationId = activeConversationId();
    return conversationId ? (sessions.get(conversationId) ?? null) : null;
  };

  const setActiveConversationId = (conversationId: string | null) => {
    if (conversationId) ensureSession(conversationId);
    setActiveConversationIdSignal(conversationId);
    touchSessions();
  };

  const messages = () => activeSession()?.messages ?? [];
  const assistantDraft = () => activeSession()?.assistantDraft ?? "";
  const assistantThinkingDraft = () => activeSession()?.assistantThinkingDraft ?? "";
  const assistantBlocks = () => activeSession()?.assistantBlocks ?? [];
  const runStatus = () => activeSession()?.runStatus ?? "idle";
  const running = () => isRunningStatus(runStatus());
  const error = () => activeSession()?.error ?? globalError();
  const approvalRequests = () => activeSession()?.approvalRequests ?? [];
  const frontendToolRequests = () => activeSession()?.frontendToolRequests ?? [];
  const activeTurn = () => activeSession()?.activeTurn ?? null;
  const setError = (message: string | null) => {
    const session = activeSession();
    if (session) session.error = message;
    else setGlobalError(message);
    touchSessions();
  };

  const isSessionRunning = (session: AiConversationSession) => isRunningStatus(session.runStatus);
  const nextUiBlockId = (session: AiConversationSession, prefix: string) => `${prefix}-${Date.now()}-${++session.uiBlockId}`;

  const resolveAssistantOutputWaiters = (session: AiConversationSession) => {
    if (session.assistantDeltaQueue || session.assistantDeltaTimer || session.pendingAssistantFinal) return;
    const waiters = session.assistantOutputWaiters;
    session.assistantOutputWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const appendTextBlockDelta = (session: AiConversationSession, delta: string) => {
    if (!delta) return;
    const last = session.assistantBlocks[session.assistantBlocks.length - 1];
    session.assistantBlocks =
      last?.type === "text"
        ? [...session.assistantBlocks.slice(0, -1), { ...last, text: last.text + delta }]
        : [...session.assistantBlocks, { id: nextUiBlockId(session, "text"), type: "text", text: delta }];
  };

  const appendThinkingBlockDelta = (session: AiConversationSession, delta: string) => {
    if (!delta) return;
    const last = session.assistantBlocks[session.assistantBlocks.length - 1];
    session.assistantBlocks =
      last?.type === "thinking"
        ? [...session.assistantBlocks.slice(0, -1), { ...last, text: last.text + delta }]
        : [...session.assistantBlocks, { id: nextUiBlockId(session, "thinking"), type: "thinking", text: delta }];
  };

  const upsertAssistantBlock = (
    session: AiConversationSession,
    block: AiUiBlock,
    match: (candidate: AiUiBlock) => boolean = (candidate) => candidate.id === block.id,
  ) => {
    const index = session.assistantBlocks.findIndex(match);
    session.assistantBlocks =
      index < 0
        ? [...session.assistantBlocks, block]
        : [...session.assistantBlocks.slice(0, index), block, ...session.assistantBlocks.slice(index + 1)];
  };

  const updateToolBlock = (session: AiConversationSession, callId: string, patch: Partial<Extract<AiUiBlock, { type: "tool_call" }>>) => {
    const index = session.assistantBlocks.findIndex((block) => block.type === "tool_call" && block.callId === callId);
    if (index < 0) {
      session.assistantBlocks = [
        ...session.assistantBlocks,
        {
          id: `tool-${callId}`,
          type: "tool_call",
          callId,
          name: patch.name ?? "tool",
          status: patch.status ?? "running",
          args: patch.args,
          result: patch.result,
        },
      ];
      return;
    }
    const existing = session.assistantBlocks[index] as Extract<AiUiBlock, { type: "tool_call" }>;
    session.assistantBlocks = [
      ...session.assistantBlocks.slice(0, index),
      { ...existing, ...patch },
      ...session.assistantBlocks.slice(index + 1),
    ];
  };

  const commitPendingAssistantFinal = (session: AiConversationSession) => {
    const final = session.pendingAssistantFinal;
    if (!final) {
      resolveAssistantOutputWaiters(session);
      return;
    }

    session.pendingAssistantFinal = null;
    session.assistantDraft = "";
    session.assistantThinkingDraft = "";
    session.assistantBlocks = [];
    session.messages = [
      ...session.messages,
      tempAssistantMessage(final.conversationId, final.message, {
        loopAggregate: final.loopAggregate,
        loopDoneReason: final.loopDoneReason,
        usage: final.loopAggregate?.usage ?? null,
        loopId: final.loopId,
      }),
    ];
    resolveAssistantOutputWaiters(session);
    touchSessions();
  };

  const nextAssistantDraftChunkSize = (session: AiConversationSession) => {
    session.assistantDeltaDrainStartedAt ??= Date.now();
    const elapsedMs = Date.now() - session.assistantDeltaDrainStartedAt;
    const remainingMs = Math.max(ASSISTANT_DRAFT_TICK_MS, ASSISTANT_DRAFT_MAX_DRAIN_MS - elapsedMs);
    const remainingTicks = Math.max(1, Math.ceil(remainingMs / ASSISTANT_DRAFT_TICK_MS));
    return Math.max(ASSISTANT_DRAFT_CHARS_PER_TICK, Math.ceil(session.assistantDeltaQueue.length / remainingTicks));
  };

  const scheduleAssistantDeltaDrain = (session: AiConversationSession) => {
    if (session.assistantDeltaTimer) return;
    session.assistantDeltaTimer = setTimeout(() => {
      session.assistantDeltaTimer = null;
      if (session.assistantDeltaQueue) {
        const next = session.assistantDeltaQueue.slice(0, nextAssistantDraftChunkSize(session));
        session.assistantDeltaQueue = session.assistantDeltaQueue.slice(next.length);
        session.assistantDraft += next;
        appendTextBlockDelta(session, next);
        touchSessions();
      }

      if (session.assistantDeltaQueue) {
        scheduleAssistantDeltaDrain(session);
      } else if (session.pendingAssistantFinal) {
        session.assistantDeltaDrainStartedAt = null;
        commitPendingAssistantFinal(session);
      } else {
        session.assistantDeltaDrainStartedAt = null;
        resolveAssistantOutputWaiters(session);
        touchSessions();
      }
    }, ASSISTANT_DRAFT_TICK_MS);
  };

  const enqueueAssistantDelta = (session: AiConversationSession, delta: string) => {
    if (!delta) return;
    session.assistantDeltaQueue += delta;
    scheduleAssistantDeltaDrain(session);
  };

  const flushAssistantOutput = (session: AiConversationSession) => {
    if (session.assistantDeltaTimer) clearTimeout(session.assistantDeltaTimer);
    session.assistantDeltaTimer = null;
    session.assistantDeltaDrainStartedAt = null;
    if (session.assistantDeltaQueue) {
      const queued = session.assistantDeltaQueue;
      session.assistantDeltaQueue = "";
      session.assistantDraft += queued;
      appendTextBlockDelta(session, queued);
    }
    if (session.pendingAssistantFinal) commitPendingAssistantFinal(session);
    else resolveAssistantOutputWaiters(session);
    touchSessions();
  };

  const clearAssistantOutput = (session: AiConversationSession) => {
    if (session.assistantDeltaTimer) clearTimeout(session.assistantDeltaTimer);
    session.assistantDeltaTimer = null;
    session.assistantDeltaDrainStartedAt = null;
    session.assistantDeltaQueue = "";
    session.pendingAssistantFinal = null;
    session.assistantDraft = "";
    session.assistantThinkingDraft = "";
    session.assistantBlocks = [];
    resolveAssistantOutputWaiters(session);
  };

  const waitForAssistantOutputSettled = (session: AiConversationSession) =>
    session.assistantDeltaQueue || session.assistantDeltaTimer || session.pendingAssistantFinal
      ? new Promise<void>((resolve) => {
          session.assistantOutputWaiters.push(resolve);
        })
      : Promise.resolve();

  const clearResumeRetry = (session: AiConversationSession) => {
    if (session.resumeRetryTimer) clearTimeout(session.resumeRetryTimer);
    session.resumeRetryTimer = null;
  };

  const resetResumeRetry = (session: AiConversationSession) => {
    clearResumeRetry(session);
    session.resumeRetryDelayMs = 1_000;
  };

  const abortStream = (session: AiConversationSession) => {
    session.abortController?.abort();
  };

  const setSessionRunning = (session: AiConversationSession, value: boolean) => {
    session.runStatus = value ? "streaming" : "idle";
  };

  const applyLoopDoneToAssistantOutput = (session: AiConversationSession, event: DoneEvent) => {
    const aggregate = event.aggregate?.assistantMessageCount ? event.aggregate : null;

    if (session.pendingAssistantFinal?.conversationId === event.conversationId) {
      session.pendingAssistantFinal = {
        ...session.pendingAssistantFinal,
        loopAggregate: aggregate,
        loopDoneReason: aggregate ? event.reason : null,
      };
      return;
    }

    if (!aggregate) return;
    const index = session.messages.findLastIndex(
      (entry) => entry.conversationId === event.conversationId && entry.kind === "message" && entry.message.role === "assistant",
    );
    if (index < 0) return;
    const entry = session.messages[index]!;
    session.messages = [
      ...session.messages.slice(0, index),
      {
        ...entry,
        usage: aggregate.usage ?? entry.usage,
        loopAggregate: aggregate,
        loopDoneReason: event.reason,
      },
      ...session.messages.slice(index + 1),
    ];
  };

  const runFrontendTool = async (session: AiConversationSession, request: FrontendToolRequest) => {
    const handler = options.frontendTools?.[request.name];
    const canAutoAcknowledgeView = request.mode === "client_view";
    const handledKey = `${request.turnId}:${request.callId}`;
    if ((!handler && !canAutoAcknowledgeView) || session.handledFrontendToolCallIds.has(handledKey)) return;
    session.handledFrontendToolCallIds.add(handledKey);

    try {
      await submitFrontendToolResult(request, handler ? await handler(request) : { displayed: true });
    } catch (toolError) {
      const message = toolError instanceof Error ? toolError.message : "Frontend AI tool failed";
      session.error = message;
      touchSessions();
      await submitFrontendToolResult(request, { error: message });
    }
  };

  const applyPendingActions = (session: AiConversationSession, actions: AiPendingTurnAction[] | undefined) => {
    const pending = actions ?? [];
    const approvals = pending.filter(isApprovalRequest);
    const frontendTools = pending.filter(isFrontendToolRequest);
    if (pending.length > 0) session.runStatus = "waiting_for_action";
    session.approvalRequests = approvals;
    session.frontendToolRequests = frontendTools;
    session.assistantBlocks = [
      ...session.assistantBlocks.filter((block) => block.type !== "approval_request" && block.type !== "frontend_tool"),
      ...pending.map(pendingActionToUiBlock),
    ];
    touchSessions();
    for (const request of frontendTools) {
      if (request.mode === "client" || request.mode === "client_view") void runFrontendTool(session, request);
    }
  };

  const scheduleResumeRetry = (session: AiConversationSession, turn: ActiveTurn) => {
    if (!(options.autoResume ?? true)) return;
    clearResumeRetry(session);
    const delay = session.resumeRetryDelayMs;
    session.resumeRetryDelayMs = Math.min(session.resumeRetryDelayMs * 2, 5_000);
    session.resumeRetryTimer = setTimeout(() => {
      session.resumeRetryTimer = null;
      if (!session.activeTurn || isSessionRunning(session) || session.activeTurn.turnId !== turn.turnId) return;
      void resume(session.activeTurn);
    }, delay);
  };

  const refreshConversations = async () => {
    const response = await options.route.conversations.$get(inputWithParams());
    if (!response.ok) throw new Error(await readAiError(response, "Failed to load conversations"));
    setConversations((await response.json()) as AiConversation[]);
  };

  const maybeResumeSession = (session: AiConversationSession) => {
    if (
      !(options.autoResume ?? true) ||
      !session.activeTurn ||
      isSessionRunning(session) ||
      session.resumedTurnId === session.activeTurn.turnId
    ) {
      return;
    }
    session.resumedTurnId = session.activeTurn.turnId;
    void resume(session.activeTurn);
  };

  const refreshConversationDetail = async (conversationId: string) => {
    const response = await options.route.conversations[":conversationId"].$get(inputWithParams({ param: { conversationId } }));
    if (!response.ok) return;
    const body = (await response.json()) as AiConversationDetail;
    const session = ensureSession(conversationId);
    session.messages = body.messages;
    session.activeTurn = body.activeTurn ? { conversationId, turnId: body.activeTurn.id, loopId: body.activeTurn.id } : null;
    if (!body.activeTurn && !isSessionRunning(session)) session.runStatus = "idle";
    applyPendingActions(session, body.pendingActions);
    maybeResumeSession(session);
    touchSessions();
  };

  const handleStreamEvent = (session: AiConversationSession, event: AiSseEvent): boolean => {
    resetResumeRetry(session);
    const loopId = eventLoopId(event);

    if (event.cursor && session.activeTurn?.turnId === event.turnId) {
      session.activeTurn = { ...session.activeTurn, loopId, cursor: event.cursor };
    }

    if (event.type === "turn_start") {
      session.activeTurn = { conversationId: event.conversationId, turnId: event.turnId, loopId, cursor: event.cursor };
      session.assistantBlocks = [];
      touchSessions();
      return false;
    }

    if (event.type === "done") {
      applyLoopDoneToAssistantOutput(session, event);
      session.activeTurn = null;
      touchSessions();
      return true;
    }

    if (event.type === "error") {
      session.error = event.message;
      upsertAssistantBlock(session, { id: `error-${loopId}`, type: "error", message: event.message });
      session.activeTurn = null;
      touchSessions();
      return true;
    }

    if (event.type === "approval_request") {
      session.runStatus = "waiting_for_action";
      session.approvalRequests = [...session.approvalRequests.filter((request) => request.callId !== event.callId), event];
      const blockId = `approval-${loopId}-${event.callId}`;
      upsertAssistantBlock(
        session,
        { id: blockId, type: "approval_request", request: event, status: "pending" },
        (block) => block.id === blockId,
      );
      touchSessions();
      return false;
    }

    if (event.type === "frontend_tool") {
      session.runStatus = "waiting_for_action";
      session.frontendToolRequests = [...session.frontendToolRequests.filter((request) => request.callId !== event.callId), event];
      const blockId = `frontend-${loopId}-${event.callId}`;
      upsertAssistantBlock(
        session,
        { id: blockId, type: "frontend_tool", request: event, status: "pending" },
        (block) => block.id === blockId,
      );
      touchSessions();
      if (event.mode === "client" || event.mode === "client_view") void runFrontendTool(session, event);
      return false;
    }

    if (event.type === "compaction_result") {
      upsertAssistantBlock(session, {
        id: `compaction-${loopId}`,
        type: "compaction",
        status: event.reason === "error" ? "failed" : event.result.applied ? "completed" : "skipped",
        result: event.result,
      });
      touchSessions();
      return false;
    }

    if (event.type !== "nessi") return false;
    const nessiEvent = event.event;
    if (nessiEvent.type === "text") {
      if (session.pendingAssistantFinal) flushAssistantOutput(session);
      enqueueAssistantDelta(session, nessiEvent.delta);
    } else if (nessiEvent.type === "thinking") {
      if (session.pendingAssistantFinal) flushAssistantOutput(session);
      session.assistantThinkingDraft += nessiEvent.delta;
      appendThinkingBlockDelta(session, nessiEvent.delta);
      touchSessions();
    } else if (nessiEvent.type === "tool_start") {
      flushAssistantOutput(session);
      session.assistantBlocks = session.assistantBlocks.map((block) =>
        block.type === "tool_call" && block.callId === nessiEvent.callId ? { ...block, name: nessiEvent.name, status: "running" } : block,
      );
      touchSessions();
    } else if (nessiEvent.type === "tool_error" || nessiEvent.type === "tool_cancel") {
      flushAssistantOutput(session);
      if (nessiEvent.callId) {
        session.assistantBlocks = session.assistantBlocks.filter(
          (block) => !(block.type === "tool_call" && block.callId === nessiEvent.callId && block.status === "running"),
        );
        touchSessions();
      }
    } else if (nessiEvent.type === "tool_call") {
      flushAssistantOutput(session);
      updateToolBlock(session, nessiEvent.callId, { name: nessiEvent.name, args: nessiEvent.args, status: "called" });
      touchSessions();
    } else if (nessiEvent.type === "tool_end") {
      flushAssistantOutput(session);
      updateToolBlock(session, nessiEvent.callId, {
        name: nessiEvent.name,
        result: nessiEvent.result,
        status: nessiEvent.isError ? "failed" : "completed",
      });
      touchSessions();
    } else if (nessiEvent.type === "compaction_start") {
      upsertAssistantBlock(session, { id: `compaction-${loopId}`, type: "compaction", status: "running" });
      touchSessions();
    } else if (nessiEvent.type === "compaction_end") {
      upsertAssistantBlock(session, { id: `compaction-${loopId}`, type: "compaction", status: "completed" });
      touchSessions();
    } else if (nessiEvent.type === "turn_end") {
      if (session.pendingAssistantFinal) flushAssistantOutput(session);
      session.pendingAssistantFinal = {
        conversationId: session.conversationId,
        message: nessiEvent.message,
        loopId,
        loopAggregate: null,
        loopDoneReason: null,
      };
      if (!session.assistantDeltaQueue && !session.assistantDeltaTimer) commitPendingAssistantFinal(session);
      touchSessions();
    } else if (nessiEvent.type === "error") {
      session.error = nessiEvent.error;
      upsertAssistantBlock(session, { id: `error-${loopId}`, type: "error", message: nessiEvent.error });
      touchSessions();
    }
    return false;
  };

  const consumeStream = async (response: Response, session: AiConversationSession, stopOnFinal: boolean): Promise<boolean> => {
    let sawFinal = false;
    for await (const event of parseAiSse(response)) {
      const final = handleStreamEvent(session, event);
      sawFinal ||= final;
      if (final && stopOnFinal) return true;
    }
    return sawFinal;
  };

  const resume = async (turn: ActiveTurn) => {
    const session = ensureSession(turn.conversationId);
    if (session.abortController && !session.abortController.signal.aborted) return false;

    const controller = new AbortController();
    const thisRun = ++session.streamRunId;
    let completed = false;
    session.abortController = controller;
    session.runStatus = "reconnecting";
    session.error = null;
    touchSessions();

    try {
      const response = await options.route.conversations[":conversationId"].turns[":turnId"].events.$get(
        inputWithParams({
          param: { conversationId: turn.conversationId, turnId: turn.turnId },
          query: { after: turn.cursor ?? "0-0" },
        }),
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await readAiError(response, "Failed to resume AI stream"));
      if (thisRun === session.streamRunId) {
        session.runStatus = "streaming";
        touchSessions();
      }
      completed = await consumeStream(response, session, true);
      if (thisRun !== session.streamRunId) return false;
      if (completed) await waitForAssistantOutputSettled(session);
      await refreshConversationDetail(turn.conversationId);
      if (completed) session.activeTurn = null;
      await refreshConversations();
      return completed;
    } catch (resumeError) {
      if (controller.signal.aborted || thisRun !== session.streamRunId) return false;
      session.runStatus = "failed";
      session.error = resumeError instanceof Error ? resumeError.message : "Failed to resume AI stream";
      touchSessions();
      return false;
    } finally {
      if (session.abortController === controller) session.abortController = null;
      if (thisRun === session.streamRunId) {
        if (session.runStatus !== "failed") setSessionRunning(session, false);
        const turnAfterRefresh = session.activeTurn;
        if (completed || !turnAfterRefresh) {
          resetResumeRetry(session);
          clearAssistantOutput(session);
        } else {
          flushAssistantOutput(session);
          scheduleResumeRetry(session, turnAfterRefresh);
        }
        touchSessions();
      }
    }
  };

  const resumeActiveTurn = () => {
    const session = activeSession();
    if (!session?.activeTurn) return;
    session.resumedTurnId = null;
    void resume(session.activeTurn);
  };

  const abort = () => {
    const session = activeSession();
    const turn = session?.activeTurn;
    if (!session || !turn) {
      if (session) abortStream(session);
      return;
    }

    session.runStatus = "stopping";
    touchSessions();
    void options.route.conversations[":conversationId"].turns[":turnId"].abort
      .$post(inputWithParams({ param: { conversationId: turn.conversationId, turnId: turn.turnId } }))
      .then(async (response) => {
        if (!response.ok) {
          session.runStatus = "failed";
          session.error = await readAiError(response, "Failed to stop AI turn");
          touchSessions();
          return;
        }
        session.streamRunId += 1;
        clearResumeRetry(session);
        flushAssistantOutput(session);
        abortStream(session);
        session.abortController = null;
        setSessionRunning(session, false);
        session.resumedTurnId = null;
        session.activeTurn = null;
        session.approvalRequests = [];
        session.frontendToolRequests = [];
        touchSessions();
        await refreshConversationDetail(turn.conversationId).catch(() => undefined);
        await refreshConversations().catch(() => undefined);
      })
      .catch((abortError) => {
        session.runStatus = "failed";
        session.error = abortError instanceof Error ? abortError.message : "Failed to stop AI turn";
        touchSessions();
      });
  };

  const openConversation = async (conversationId: string) => {
    const session = ensureSession(conversationId);
    session.error = null;
    touchSessions();
    const response = await options.route.conversations[":conversationId"].$get(inputWithParams({ param: { conversationId } }));
    if (!response.ok) {
      session.error = await readAiError(response, "Failed to open conversation");
      touchSessions();
      return;
    }
    const detail = (await response.json()) as AiConversationDetail;
    const loaded = ensureSession(detail.conversation.id);
    loaded.messages = detail.messages;
    loaded.resumedTurnId = null;
    loaded.activeTurn = detail.activeTurn
      ? { conversationId: detail.conversation.id, turnId: detail.activeTurn.id, loopId: detail.activeTurn.id }
      : null;
    if (!detail.activeTurn && !isSessionRunning(loaded)) loaded.runStatus = "idle";
    applyPendingActions(loaded, detail.pendingActions);
    setActiveConversationId(detail.conversation.id);
    maybeResumeSession(loaded);
  };

  const createConversation = async (input: { title?: string } = {}, _behavior: { detachActiveRun?: boolean } = {}) => {
    const response = await options.route.conversations.$post(inputWithParams({ json: input }));
    if (!response.ok) {
      setError(await readAiError(response, "Failed to create conversation"));
      return null;
    }
    const conversation = (await response.json()) as AiConversation;
    const session = ensureSession(conversation.id);
    clearAssistantOutput(session);
    session.messages = [];
    session.resumedTurnId = null;
    session.activeTurn = null;
    session.runStatus = "idle";
    session.approvalRequests = [];
    session.frontendToolRequests = [];
    session.error = null;
    setConversations((prev) => [conversation, ...prev.filter((item) => item.id !== conversation.id)]);
    setActiveConversationId(conversation.id);
    touchSessions();
    return conversation;
  };

  const ensureConversation = async () => {
    const current = activeConversationId();
    if (current) return current;
    const conversation = await createConversation({}, { detachActiveRun: false });
    return conversation?.id ?? null;
  };

  const send = async (input: { message?: string; content?: AiUserContentPart[]; modelProfileId?: string }) => {
    const text = input.message?.trim() ?? "";
    const content = input.content?.length ? input.content : text ? ([{ type: "text", text }] satisfies AiUserContentPart[]) : [];
    if (content.length === 0) return false;

    const conversationId = await ensureConversation();
    if (!conversationId) return false;
    const session = ensureSession(conversationId);
    if (isSessionRunning(session) || session.activeTurn) return false;

    const controller = new AbortController();
    const thisRun = ++session.streamRunId;
    let completed = false;
    session.error = null;
    session.runStatus = "sending";
    clearAssistantOutput(session);
    resetResumeRetry(session);
    session.approvalRequests = [];
    session.frontendToolRequests = [];
    session.abortController = controller;
    session.messages = [...session.messages, tempUserMessage(conversationId, content)];
    touchSessions();

    try {
      const response = await options.route.conversations[":conversationId"].turns.$post(
        inputWithParams({
          param: { conversationId },
          json: {
            message: text || undefined,
            content: input.content?.length ? content : undefined,
            modelProfileId: input.modelProfileId || undefined,
          },
        }),
        { init: { signal: controller.signal } },
      );

      if (!response.ok) throw new Error(await readAiError(response, "AI request failed"));
      if (thisRun === session.streamRunId) {
        session.runStatus = "streaming";
        touchSessions();
      }
      completed = await consumeStream(response, session, false);
      if (thisRun !== session.streamRunId) return false;
      if (completed) await waitForAssistantOutputSettled(session);
      await refreshConversationDetail(conversationId);
      await refreshConversations();
      return true;
    } catch (sendError) {
      if (thisRun === session.streamRunId) {
        session.runStatus = "failed";
        session.error = controller.signal.aborted
          ? "AI request stopped."
          : sendError instanceof Error
            ? sendError.message
            : "AI request failed";
        touchSessions();
      }
      return false;
    } finally {
      if (session.abortController === controller) session.abortController = null;
      if (thisRun === session.streamRunId) {
        if (session.runStatus !== "failed") setSessionRunning(session, false);
        const turnAfterRefresh = session.activeTurn;
        if (completed || !turnAfterRefresh) {
          resetResumeRetry(session);
          clearAssistantOutput(session);
        } else {
          flushAssistantOutput(session);
          scheduleResumeRetry(session, turnAfterRefresh);
        }
        touchSessions();
      }
    }
  };

  const compactConversation = async (input: { modelProfileId?: string } = {}) => {
    const conversationId = activeConversationId();
    const session = conversationId ? ensureSession(conversationId) : null;
    const compactRoute = conversationId ? options.route.conversations[":conversationId"].compact : undefined;
    if (!conversationId || !session) return false;
    if (!compactRoute) {
      session.error = "Compaction is not available for this chat.";
      touchSessions();
      return false;
    }
    if (isSessionRunning(session) || session.activeTurn) {
      session.error = "Stop the current response before compacting context.";
      touchSessions();
      return false;
    }

    const controller = new AbortController();
    const thisRun = ++session.streamRunId;
    let completed = false;
    session.error = null;
    session.runStatus = "sending";
    clearAssistantOutput(session);
    resetResumeRetry(session);
    session.approvalRequests = [];
    session.frontendToolRequests = [];
    session.abortController = controller;
    touchSessions();

    try {
      const response = await compactRoute.$post(
        inputWithParams({
          param: { conversationId },
          json: { modelProfileId: input.modelProfileId || undefined },
        }),
        { init: { signal: controller.signal } },
      );

      if (!response.ok) throw new Error(await readAiError(response, "AI compaction failed"));
      if (thisRun === session.streamRunId) {
        session.runStatus = "streaming";
        touchSessions();
      }
      completed = await consumeStream(response, session, false);
      if (thisRun !== session.streamRunId) return false;
      if (completed) await waitForAssistantOutputSettled(session);
      await refreshConversationDetail(conversationId);
      await refreshConversations();
      return true;
    } catch (compactError) {
      if (thisRun === session.streamRunId) {
        session.runStatus = "failed";
        session.error = controller.signal.aborted
          ? "AI compaction stopped."
          : compactError instanceof Error
            ? compactError.message
            : "AI compaction failed";
        touchSessions();
      }
      return false;
    } finally {
      if (session.abortController === controller) session.abortController = null;
      if (thisRun === session.streamRunId) {
        if (session.runStatus !== "failed") setSessionRunning(session, false);
        const turnAfterRefresh = session.activeTurn;
        if (completed || !turnAfterRefresh) {
          resetResumeRetry(session);
          if (completed) flushAssistantOutput(session);
          else clearAssistantOutput(session);
        } else {
          flushAssistantOutput(session);
          scheduleResumeRetry(session, turnAfterRefresh);
        }
        touchSessions();
      }
    }
  };

  const forkMessage = async (messageId: string, input: { title?: string } = {}) => {
    const conversationId = activeConversationId();
    const session = conversationId ? ensureSession(conversationId) : null;
    if (!conversationId || !session || isSessionRunning(session)) return null;

    session.error = null;
    touchSessions();
    const response = await options.route.conversations[":conversationId"].messages[":messageId"].fork.$post(
      inputWithParams({ param: { conversationId, messageId }, json: input }),
    );
    if (!response.ok) {
      session.error = await readAiError(response, "Failed to fork conversation");
      touchSessions();
      return null;
    }

    const detail = (await response.json()) as AiConversationDetail;
    const forked = ensureSession(detail.conversation.id);
    forked.messages = detail.messages;
    forked.resumedTurnId = null;
    forked.activeTurn = detail.activeTurn
      ? { conversationId: detail.conversation.id, turnId: detail.activeTurn.id, loopId: detail.activeTurn.id }
      : null;
    if (!detail.activeTurn) forked.runStatus = "idle";
    applyPendingActions(forked, detail.pendingActions);
    setConversations((prev) => [detail.conversation, ...prev.filter((conversation) => conversation.id !== detail.conversation.id)]);
    setActiveConversationId(detail.conversation.id);
    maybeResumeSession(forked);
    await refreshConversations().catch(() => undefined);
    return detail.conversation;
  };

  const retryUserMessage = async (
    messageId: string,
    input: { content?: AiUserContentPart[]; mode?: AiMessageRetryMode; modelProfileId?: string } = {},
  ): Promise<boolean> => {
    const conversationId = activeConversationId();
    const session = conversationId ? ensureSession(conversationId) : null;
    if (!conversationId || !session) return false;
    if (isSessionRunning(session)) {
      session.error = "Stop the current response before trying again.";
      touchSessions();
      return false;
    }

    const currentMessages = session.messages;
    const target = currentMessages.find((message) => message.id === messageId);
    if (!target || target.kind !== "message" || target.message.role !== "user") {
      session.error = "Could not find a user message to retry.";
      touchSessions();
      return false;
    }
    const content = input.content?.length ? input.content : target.message.content;
    const snapshot = {
      messages: session.messages,
      activeTurn: session.activeTurn,
      assistantDraft: session.assistantDraft,
      assistantThinkingDraft: session.assistantThinkingDraft,
      assistantBlocks: session.assistantBlocks,
      approvalRequests: session.approvalRequests,
      frontendToolRequests: session.frontendToolRequests,
      resumedTurnId: session.resumedTurnId,
    };

    const controller = new AbortController();
    const thisRun = ++session.streamRunId;
    let completed = false;
    session.error = null;
    session.runStatus = "sending";
    resetResumeRetry(session);
    session.resumedTurnId = null;
    session.activeTurn = null;
    clearAssistantOutput(session);
    session.approvalRequests = [];
    session.frontendToolRequests = [];
    session.abortController = controller;
    session.messages = [...currentMessages.filter((message) => message.seq < target.seq), tempUserMessage(conversationId, content)];
    touchSessions();

    try {
      const response = await options.route.conversations[":conversationId"].messages[":messageId"].retry.$post(
        inputWithParams({
          param: { conversationId, messageId },
          json: {
            mode: input.mode ?? "retry",
            content: input.content?.length ? content : undefined,
            modelProfileId: input.modelProfileId || undefined,
          },
        }),
        { init: { signal: controller.signal } },
      );

      if (!response.ok) throw new Error(await readAiError(response, "AI retry failed"));
      if (thisRun === session.streamRunId) {
        session.runStatus = "streaming";
        touchSessions();
      }
      completed = await consumeStream(response, session, false);
      if (thisRun !== session.streamRunId) return false;
      if (completed) await waitForAssistantOutputSettled(session);
      await refreshConversationDetail(conversationId);
      await refreshConversations();
      return true;
    } catch (retryError) {
      if (thisRun === session.streamRunId) {
        session.runStatus = "failed";
        session.messages = snapshot.messages;
        session.activeTurn = snapshot.activeTurn;
        session.assistantDraft = snapshot.assistantDraft;
        session.assistantThinkingDraft = snapshot.assistantThinkingDraft;
        session.assistantBlocks = snapshot.assistantBlocks;
        session.approvalRequests = snapshot.approvalRequests;
        session.frontendToolRequests = snapshot.frontendToolRequests;
        session.resumedTurnId = snapshot.resumedTurnId;
        session.error = controller.signal.aborted
          ? "AI request stopped."
          : retryError instanceof Error
            ? retryError.message
            : "AI retry failed";
        touchSessions();
      }
      return false;
    } finally {
      if (session.abortController === controller) session.abortController = null;
      if (thisRun === session.streamRunId) {
        if (session.runStatus !== "failed") setSessionRunning(session, false);
        const turnAfterRefresh = session.activeTurn;
        if (completed || !turnAfterRefresh) {
          resetResumeRetry(session);
          clearAssistantOutput(session);
        } else {
          flushAssistantOutput(session);
          scheduleResumeRetry(session, turnAfterRefresh);
        }
        touchSessions();
      }
    }
  };

  const submitTurnAction = async (input: {
    conversationId: string;
    turnId: string;
    callId: string;
    action: TurnActionInput;
  }): Promise<boolean> => {
    const session = ensureSession(input.conversationId);
    const response = await options.route.conversations[":conversationId"].turns[":turnId"].actions[":callId"].$post(
      inputWithParams({
        param: { conversationId: input.conversationId, turnId: input.turnId, callId: input.callId },
        json: input.action,
      }),
    );
    if (!response.ok) {
      session.error = await readAiError(response, "Failed to continue AI turn");
      touchSessions();
      return false;
    }
    const remainingActionCount =
      session.approvalRequests.filter((request) => request.callId !== input.callId).length +
      session.frontendToolRequests.filter((request) => request.callId !== input.callId).length;
    session.approvalRequests = session.approvalRequests.filter((request) => request.callId !== input.callId);
    session.frontendToolRequests = session.frontendToolRequests.filter((request) => request.callId !== input.callId);
    const turn = session.activeTurn;
    if (turn && turn.turnId === input.turnId) {
      if (remainingActionCount > 0) session.runStatus = "waiting_for_action";
      else if (session.abortController && !session.abortController.signal.aborted) session.runStatus = "streaming";
      else void resume(turn);
    }
    touchSessions();
    return true;
  };

  const respondToApproval = (request: ApprovalRequest, input: { approved: boolean; remember?: "always" }) =>
    submitTurnAction({
      conversationId: request.conversationId,
      turnId: request.turnId,
      callId: request.callId,
      action: { type: "approval_response", approved: input.approved, remember: input.remember },
    }).then((ok) => {
      if (!ok) return false;
      const session = ensureSession(request.conversationId);
      const blockId = `approval-${eventLoopId(request)}-${request.callId}`;
      upsertAssistantBlock(
        session,
        { id: blockId, type: "approval_request", request, status: input.approved ? "approved" : "rejected" },
        (block) => block.id === blockId,
      );
      touchSessions();
      return true;
    });

  const submitFrontendToolResult = (request: FrontendToolRequest, result: unknown) =>
    submitTurnAction({
      conversationId: request.conversationId,
      turnId: request.turnId,
      callId: request.callId,
      action: { type: "tool_result", result },
    }).then((ok) => {
      if (!ok) return false;
      const session = ensureSession(request.conversationId);
      const blockId = `frontend-${eventLoopId(request)}-${request.callId}`;
      upsertAssistantBlock(
        session,
        { id: blockId, type: "frontend_tool", request, status: "completed", result },
        (block) => block.id === blockId,
      );
      touchSessions();
      return true;
    });

  if (options.initialPendingActions?.length && options.initialConversationId) {
    queueMicrotask(() => applyPendingActions(ensureSession(options.initialConversationId!), options.initialPendingActions));
  }
  if (options.initialActiveTurn && options.initialConversationId && (options.autoResume ?? true)) {
    queueMicrotask(() => maybeResumeSession(ensureSession(options.initialConversationId!)));
  }

  onCleanup(() => {
    for (const session of sessions.values()) {
      clearResumeRetry(session);
      clearAssistantOutput(session);
      abortStream(session);
    }
  });

  return {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    messages,
    assistantDraft,
    assistantThinkingDraft,
    assistantBlocks,
    runStatus,
    running,
    error,
    setError,
    approvalRequests,
    frontendToolRequests,
    activeTurn,
    abort,
    refreshConversations,
    refreshConversationDetail,
    openConversation,
    createConversation,
    send,
    compactConversation,
    forkMessage,
    retryUserMessage,
    resume,
    resumeActiveTurn,
    submitTurnAction,
    respondToApproval,
    submitFrontendToolResult,
  };
};

export type AiChatController = ReturnType<typeof createAiChatController>;
