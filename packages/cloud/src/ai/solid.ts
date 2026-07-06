import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";
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

const eventLoopId = (event: AiSseEvent): string => event.loopId ?? (event.type === "nessi" ? event.event.loopId : undefined) ?? event.turnId;

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

export const createAiChatController = <TRoute extends AiChatRouteBranch>(options: CreateAiChatControllerOptions<TRoute>) => {
  const [conversations, setConversations] = createSignal(options.initialConversations ?? []);
  const [activeConversationId, setActiveConversationId] = createSignal<string | null>(options.initialConversationId ?? null);
  const [messages, setMessages] = createSignal(options.initialMessages ?? []);
  const [assistantDraft, setAssistantDraft] = createSignal("");
  const [assistantThinkingDraft, setAssistantThinkingDraft] = createSignal("");
  const [assistantBlocks, setAssistantBlocks] = createSignal<AiUiBlock[]>(
    (options.initialPendingActions ?? []).map(pendingActionToUiBlock),
  );
  const initialRunStatus: AiChatRunStatus = options.initialPendingActions?.length ? "waiting_for_action" : "idle";
  const [runStatus, setRunStatus] = createSignal<AiChatRunStatus>(initialRunStatus);
  const running = () =>
    runStatus() === "sending" ||
    runStatus() === "streaming" ||
    runStatus() === "waiting_for_action" ||
    runStatus() === "reconnecting" ||
    runStatus() === "stopping";
  const setRunning = (value: boolean) => setRunStatus(value ? "streaming" : "idle");
  const [error, setError] = createSignal<string | null>(options.initialError ?? null);
  const [approvalRequests, setApprovalRequests] = createSignal<ApprovalRequest[]>(
    (options.initialPendingActions ?? []).filter(isApprovalRequest),
  );
  const [frontendToolRequests, setFrontendToolRequests] = createSignal<FrontendToolRequest[]>(
    (options.initialPendingActions ?? []).filter(isFrontendToolRequest),
  );
  const [activeTurn, setActiveTurn] = createSignal<ActiveTurn | null>(
    options.initialConversationId && options.initialActiveTurn
      ? { conversationId: options.initialConversationId, turnId: options.initialActiveTurn.id, loopId: options.initialActiveTurn.id }
      : null,
  );

  let activeAbortController: AbortController | null = null;
  let resumedTurnId: string | null = null;
  let resumeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let resumeRetryDelayMs = 1_000;
  let assistantDeltaQueue = "";
  let assistantDeltaTimer: ReturnType<typeof setTimeout> | null = null;
  let assistantDeltaDrainStartedAt: number | null = null;
  let pendingAssistantFinal: {
    conversationId: string;
    message: AiStoredMessage["message"];
    loopId: string | null;
    loopAggregate: DoneEvent["aggregate"];
    loopDoneReason: DoneEvent["reason"] | null;
  } | null = null;
  let assistantOutputWaiters: Array<() => void> = [];
  let runId = 0;
  let uiBlockId = 0;
  const handledFrontendToolCallIds = new Set<string>();

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

  const setStreamController = (controller: AbortController | null) => {
    activeAbortController = controller;
  };

  const clearPendingActions = () => {
    setApprovalRequests([]);
    setFrontendToolRequests([]);
  };

  const nextUiBlockId = (prefix: string) => `${prefix}-${Date.now()}-${++uiBlockId}`;

  const appendTextBlockDelta = (delta: string) => {
    if (!delta) return;
    setAssistantBlocks((prev) => {
      const last = prev[prev.length - 1];
      if (last?.type === "text") return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
      return [...prev, { id: nextUiBlockId("text"), type: "text", text: delta }];
    });
  };

  const appendThinkingBlockDelta = (delta: string) => {
    if (!delta) return;
    setAssistantBlocks((prev) => {
      const last = prev[prev.length - 1];
      if (last?.type === "thinking") return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
      return [...prev, { id: nextUiBlockId("thinking"), type: "thinking", text: delta }];
    });
  };

  const upsertAssistantBlock = (block: AiUiBlock, match: (candidate: AiUiBlock) => boolean = (candidate) => candidate.id === block.id) => {
    setAssistantBlocks((prev) => {
      const index = prev.findIndex(match);
      if (index < 0) return [...prev, block];
      return [...prev.slice(0, index), block, ...prev.slice(index + 1)];
    });
  };

  const updateToolBlock = (callId: string, patch: Partial<Extract<AiUiBlock, { type: "tool_call" }>>) => {
    setAssistantBlocks((prev) => {
      const index = prev.findIndex((block) => block.type === "tool_call" && block.callId === callId);
      if (index < 0) {
        return [
          ...prev,
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
      }
      const existing = prev[index] as Extract<AiUiBlock, { type: "tool_call" }>;
      return [...prev.slice(0, index), { ...existing, ...patch }, ...prev.slice(index + 1)];
    });
  };

  const resolveAssistantOutputWaiters = () => {
    if (assistantDeltaQueue || assistantDeltaTimer || pendingAssistantFinal) return;
    const waiters = assistantOutputWaiters;
    assistantOutputWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const commitPendingAssistantFinal = () => {
    const final = pendingAssistantFinal;
    if (!final) {
      resolveAssistantOutputWaiters();
      return;
    }

    pendingAssistantFinal = null;
    setAssistantDraft("");
    setAssistantThinkingDraft("");
    setAssistantBlocks([]);
    setMessages((prev) => [
      ...prev,
      tempAssistantMessage(final.conversationId, final.message, {
        loopAggregate: final.loopAggregate,
        loopDoneReason: final.loopDoneReason,
        usage: final.loopAggregate?.usage ?? null,
        loopId: final.loopId,
      }),
    ]);
    resolveAssistantOutputWaiters();
  };

  const nextAssistantDraftChunkSize = () => {
    assistantDeltaDrainStartedAt ??= Date.now();
    const elapsedMs = Date.now() - assistantDeltaDrainStartedAt;
    const remainingMs = Math.max(ASSISTANT_DRAFT_TICK_MS, ASSISTANT_DRAFT_MAX_DRAIN_MS - elapsedMs);
    const remainingTicks = Math.max(1, Math.ceil(remainingMs / ASSISTANT_DRAFT_TICK_MS));
    return Math.max(ASSISTANT_DRAFT_CHARS_PER_TICK, Math.ceil(assistantDeltaQueue.length / remainingTicks));
  };

  const scheduleAssistantDeltaDrain = () => {
    if (assistantDeltaTimer) return;
    assistantDeltaTimer = setTimeout(() => {
      assistantDeltaTimer = null;
      if (assistantDeltaQueue) {
        const next = assistantDeltaQueue.slice(0, nextAssistantDraftChunkSize());
        assistantDeltaQueue = assistantDeltaQueue.slice(next.length);
        setAssistantDraft((prev) => prev + next);
        appendTextBlockDelta(next);
      }

      if (assistantDeltaQueue) {
        scheduleAssistantDeltaDrain();
      } else if (pendingAssistantFinal) {
        assistantDeltaDrainStartedAt = null;
        commitPendingAssistantFinal();
      } else {
        assistantDeltaDrainStartedAt = null;
        resolveAssistantOutputWaiters();
      }
    }, ASSISTANT_DRAFT_TICK_MS);
  };

  const enqueueAssistantDelta = (delta: string) => {
    if (!delta) return;
    assistantDeltaQueue += delta;
    scheduleAssistantDeltaDrain();
  };

  const flushAssistantOutput = () => {
    if (assistantDeltaTimer) clearTimeout(assistantDeltaTimer);
    assistantDeltaTimer = null;
    assistantDeltaDrainStartedAt = null;
    if (assistantDeltaQueue) {
      const queued = assistantDeltaQueue;
      assistantDeltaQueue = "";
      setAssistantDraft((prev) => prev + queued);
      appendTextBlockDelta(queued);
    }
    if (pendingAssistantFinal) commitPendingAssistantFinal();
    else resolveAssistantOutputWaiters();
  };

  const clearAssistantOutput = () => {
    if (assistantDeltaTimer) clearTimeout(assistantDeltaTimer);
    assistantDeltaTimer = null;
    assistantDeltaDrainStartedAt = null;
    assistantDeltaQueue = "";
    pendingAssistantFinal = null;
    setAssistantDraft("");
    setAssistantThinkingDraft("");
    setAssistantBlocks([]);
    resolveAssistantOutputWaiters();
  };

  const applyLoopDoneToAssistantOutput = (event: DoneEvent) => {
    const aggregate = event.aggregate?.assistantMessageCount ? event.aggregate : null;

    if (pendingAssistantFinal?.conversationId === event.conversationId) {
      pendingAssistantFinal = {
        ...pendingAssistantFinal,
        loopAggregate: aggregate,
        loopDoneReason: aggregate ? event.reason : null,
      };
      return;
    }

    if (!aggregate) return;
    setMessages((prev) => {
      const index = prev.findLastIndex(
        (entry) => entry.conversationId === event.conversationId && entry.kind === "message" && entry.message.role === "assistant",
      );
      if (index < 0) return prev;
      const entry = prev[index]!;
      return [
        ...prev.slice(0, index),
        {
          ...entry,
          usage: aggregate.usage ?? entry.usage,
          loopAggregate: aggregate,
          loopDoneReason: event.reason,
        },
        ...prev.slice(index + 1),
      ];
    });
  };

  const waitForAssistantOutputSettled = () =>
    assistantDeltaQueue || assistantDeltaTimer || pendingAssistantFinal
      ? new Promise<void>((resolve) => {
          assistantOutputWaiters.push(resolve);
        })
      : Promise.resolve();

  const applyPendingActions = (actions: AiPendingTurnAction[] | undefined) => {
    const pending = actions ?? [];
    const approvals = pending.filter(isApprovalRequest);
    const frontendTools = pending.filter(isFrontendToolRequest);
    if (pending.length > 0) setRunStatus("waiting_for_action");
    setApprovalRequests(approvals);
    setFrontendToolRequests(frontendTools);
    setAssistantBlocks((prev) => {
      const withoutPending = prev.filter((block) => block.type !== "approval_request" && block.type !== "frontend_tool");
      return [...withoutPending, ...pending.map(pendingActionToUiBlock)];
    });
    for (const request of frontendTools) {
      if (request.mode === "client" || request.mode === "client_view") void runFrontendTool(request);
    }
  };

  const abortStream = () => {
    activeAbortController?.abort();
  };

  const detachActiveRun = () => {
    runId += 1;
    clearResumeRetry();
    abortStream();
    setStreamController(null);
    setRunning(false);
    resumedTurnId = null;
    setActiveTurn(null);
    clearAssistantOutput();
    clearPendingActions();
  };

  const detachStoppedRun = () => {
    runId += 1;
    clearResumeRetry();
    flushAssistantOutput();
    abortStream();
    setStreamController(null);
    setRunning(false);
    resumedTurnId = null;
    setActiveTurn(null);
    clearPendingActions();
  };

  const clearResumeRetry = () => {
    if (resumeRetryTimer) clearTimeout(resumeRetryTimer);
    resumeRetryTimer = null;
  };

  const resetResumeRetry = () => {
    clearResumeRetry();
    resumeRetryDelayMs = 1_000;
  };

  const scheduleResumeRetry = (turn: ActiveTurn) => {
    if (!(options.autoResume ?? true)) return;
    clearResumeRetry();
    const delay = resumeRetryDelayMs;
    resumeRetryDelayMs = Math.min(resumeRetryDelayMs * 2, 5_000);
    resumeRetryTimer = setTimeout(() => {
      resumeRetryTimer = null;
      const current = activeTurn();
      if (!current || running() || current.turnId !== turn.turnId || current.conversationId !== turn.conversationId) return;
      void resume(current);
    }, delay);
  };

  const abort = () => {
    const turn = activeTurn();
    if (!turn) {
      abortStream();
      return;
    }

    setRunStatus("stopping");
    void options.route.conversations[":conversationId"].turns[":turnId"].abort
      .$post(inputWithParams({ param: { conversationId: turn.conversationId, turnId: turn.turnId } }))
      .then(async (response) => {
        if (!response.ok) {
          setRunStatus("failed");
          setError(await readAiError(response, "Failed to stop AI turn"));
          return;
        }
        detachStoppedRun();
        await refreshConversationDetail(turn.conversationId).catch(() => undefined);
        await refreshConversations().catch(() => undefined);
      })
      .catch((abortError) => {
        setRunStatus("failed");
        setError(abortError instanceof Error ? abortError.message : "Failed to stop AI turn");
      });
  };

  onCleanup(() => {
    clearResumeRetry();
    clearAssistantOutput();
    abortStream();
  });

  const refreshConversations = async () => {
    const response = await options.route.conversations.$get(inputWithParams());
    if (!response.ok) throw new Error(await readAiError(response, "Failed to load conversations"));
    setConversations((await response.json()) as AiConversation[]);
  };

  const refreshConversationDetail = async (conversationId: string) => {
    const response = await options.route.conversations[":conversationId"].$get(inputWithParams({ param: { conversationId } }));
    if (!response.ok) return;
    const body = (await response.json()) as AiConversationDetail;
    setMessages(body.messages);
    setActiveTurn(body.activeTurn ? { conversationId, turnId: body.activeTurn.id, loopId: body.activeTurn.id } : null);
    applyPendingActions(body.pendingActions);
  };

  const handleStreamEvent = (event: AiSseEvent, conversationId: string): boolean => {
    resetResumeRetry();
    const loopId = eventLoopId(event);

    if (event.cursor) {
      setActiveTurn((prev) => (prev && prev.turnId === event.turnId ? { ...prev, loopId, cursor: event.cursor } : prev));
    }

    if (event.type === "turn_start") {
      setActiveTurn({ conversationId, turnId: event.turnId, loopId, cursor: event.cursor });
      setAssistantBlocks([]);
      return false;
    }

    if (event.type === "done") {
      applyLoopDoneToAssistantOutput(event);
      setActiveTurn(null);
      return true;
    }

    if (event.type === "error") {
      setError(event.message);
      upsertAssistantBlock({ id: `error-${loopId}`, type: "error", message: event.message });
      setActiveTurn(null);
      return true;
    }

    if (event.type === "approval_request") {
      setRunStatus("waiting_for_action");
      setApprovalRequests((prev) => [...prev.filter((request) => request.callId !== event.callId), event]);
      const blockId = `approval-${loopId}-${event.callId}`;
      upsertAssistantBlock(
        { id: blockId, type: "approval_request", request: event, status: "pending" },
        (block) => block.id === blockId,
      );
      return false;
    }

    if (event.type === "frontend_tool") {
      setRunStatus("waiting_for_action");
      setFrontendToolRequests((prev) => [...prev.filter((request) => request.callId !== event.callId), event]);
      const blockId = `frontend-${loopId}-${event.callId}`;
      upsertAssistantBlock(
        { id: blockId, type: "frontend_tool", request: event, status: "pending" },
        (block) => block.id === blockId,
      );
      if (event.mode === "client" || event.mode === "client_view") void runFrontendTool(event);
      return false;
    }

    if (event.type !== "nessi") return false;
    const nessiEvent = event.event;
    if (nessiEvent.type === "text") {
      if (pendingAssistantFinal) flushAssistantOutput();
      enqueueAssistantDelta(nessiEvent.delta);
    } else if (nessiEvent.type === "thinking") {
      if (pendingAssistantFinal) flushAssistantOutput();
      setAssistantThinkingDraft((prev) => prev + nessiEvent.delta);
      appendThinkingBlockDelta(nessiEvent.delta);
    } else if (nessiEvent.type === "tool_start") {
      flushAssistantOutput();
      // Keep visible tool execution tied to `tool_call`. Nessi 0.3 emits root
      // `tool_start` only after validation, but old replayed events may not.
      setAssistantBlocks((prev) =>
        prev.map((block) =>
          block.type === "tool_call" && block.callId === nessiEvent.callId
            ? { ...block, name: nessiEvent.name, status: "running" }
            : block,
        ),
      );
    } else if (nessiEvent.type === "tool_error" || nessiEvent.type === "tool_cancel") {
      flushAssistantOutput();
      if (nessiEvent.callId) {
        setAssistantBlocks((prev) =>
          prev.filter((block) => !(block.type === "tool_call" && block.callId === nessiEvent.callId && block.status === "running")),
        );
      }
    } else if (nessiEvent.type === "tool_call") {
      flushAssistantOutput();
      updateToolBlock(nessiEvent.callId, { name: nessiEvent.name, args: nessiEvent.args, status: "called" });
    } else if (nessiEvent.type === "tool_end") {
      flushAssistantOutput();
      updateToolBlock(nessiEvent.callId, {
        name: nessiEvent.name,
        result: nessiEvent.result,
        status: nessiEvent.isError ? "failed" : "completed",
      });
    } else if (nessiEvent.type === "compaction_start") {
      upsertAssistantBlock({ id: `compaction-${loopId}`, type: "compaction", status: "running" });
    } else if (nessiEvent.type === "compaction_end") {
      upsertAssistantBlock({ id: `compaction-${loopId}`, type: "compaction", status: "completed" });
    } else if (nessiEvent.type === "turn_end") {
      if (pendingAssistantFinal) flushAssistantOutput();
      pendingAssistantFinal = { conversationId, message: nessiEvent.message, loopId, loopAggregate: null, loopDoneReason: null };
      if (!assistantDeltaQueue && !assistantDeltaTimer) commitPendingAssistantFinal();
    } else if (nessiEvent.type === "error") {
      setError(nessiEvent.error);
      upsertAssistantBlock({ id: `error-${loopId}`, type: "error", message: nessiEvent.error });
    }
    return false;
  };

  async function runFrontendTool(request: FrontendToolRequest) {
    const handler = options.frontendTools?.[request.name];
    const canAutoAcknowledgeView = request.mode === "client_view" && (request.name === "card" || request.name === "cloud_card");
    if ((!handler && !canAutoAcknowledgeView) || handledFrontendToolCallIds.has(request.callId)) return;
    handledFrontendToolCallIds.add(request.callId);

    try {
      await submitFrontendToolResult(request, handler ? await handler(request) : { displayed: true });
    } catch (toolError) {
      const message = toolError instanceof Error ? toolError.message : "Frontend AI tool failed";
      setError(message);
      await submitFrontendToolResult(request, { error: message });
    }
  }

  createEffect(() => {
    for (const request of frontendToolRequests()) {
      if (request.mode === "client" || request.mode === "client_view") void runFrontendTool(request);
    }
  });

  const consumeStream = async (response: Response, conversationId: string, stopOnFinal: boolean): Promise<boolean> => {
    let sawFinal = false;
    for await (const event of parseAiSse(response)) {
      const final = handleStreamEvent(event, conversationId);
      sawFinal ||= final;
      if (final && stopOnFinal) return true;
    }
    return sawFinal;
  };

  const resume = async (turn: ActiveTurn) => {
    const controller = new AbortController();
    const thisRun = ++runId;
    let completed = false;
    setStreamController(controller);
    setRunStatus("reconnecting");
    setError(null);

    try {
      const response = await options.route.conversations[":conversationId"].turns[":turnId"].events.$get(
        inputWithParams({
          param: { conversationId: turn.conversationId, turnId: turn.turnId },
          query: { after: turn.cursor ?? "0-0" },
        }),
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await readAiError(response, "Failed to resume AI stream"));
      if (thisRun === runId) setRunStatus("streaming");
      completed = await consumeStream(response, turn.conversationId, true);
      if (thisRun !== runId) return;
      if (completed) await waitForAssistantOutputSettled();
      await refreshConversationDetail(turn.conversationId);
      if (completed) setActiveTurn(null);
      await refreshConversations();
    } catch (resumeError) {
      if (controller.signal.aborted || thisRun !== runId) return;
      setRunStatus("failed");
      setError(resumeError instanceof Error ? resumeError.message : "Failed to resume AI stream");
    } finally {
      if (activeAbortController === controller) setStreamController(null);
      if (thisRun === runId) {
        if (runStatus() !== "failed") setRunning(false);
        const turnAfterRefresh = activeTurn();
        if (completed || !turnAfterRefresh) {
          resetResumeRetry();
          clearAssistantOutput();
        } else {
          flushAssistantOutput();
          scheduleResumeRetry(turnAfterRefresh);
        }
      }
    }
  };

  const resumeActiveTurn = () => {
    const turn = activeTurn();
    if (!turn) return;
    resumedTurnId = null;
    void resume(turn);
  };

  if (options.autoResume ?? true) {
    createEffect(() => {
      const turn = activeTurn();
      if (!turn || running() || resumedTurnId === turn.turnId) return;
      resumedTurnId = turn.turnId;
      void resume(turn);
    });
  }

  const openConversation = async (conversationId: string) => {
    const shouldDetach = Boolean(running() || activeTurn());
    setError(null);
    resetResumeRetry();
    clearAssistantOutput();
    clearPendingActions();
    const response = await options.route.conversations[":conversationId"].$get(inputWithParams({ param: { conversationId } }));
    if (!response.ok) {
      setError(await readAiError(response, "Failed to open conversation"));
      return;
    }
    const detail = (await response.json()) as AiConversationDetail;
    if (shouldDetach) detachActiveRun();
    setActiveConversationId(detail.conversation.id);
    setMessages(detail.messages);
    resumedTurnId = null;
    setActiveTurn(
      detail.activeTurn ? { conversationId: detail.conversation.id, turnId: detail.activeTurn.id, loopId: detail.activeTurn.id } : null,
    );
    if (!detail.activeTurn) setRunStatus("idle");
    applyPendingActions(detail.pendingActions);
  };

  const createConversation = async (input: { title?: string } = {}, behavior: { detachActiveRun?: boolean } = {}) => {
    const shouldDetach = behavior.detachActiveRun !== false && Boolean(running() || activeTurn());
    resetResumeRetry();
    clearAssistantOutput();
    const response = await options.route.conversations.$post(inputWithParams({ json: input }));
    if (!response.ok) {
      setError(await readAiError(response, "Failed to create conversation"));
      return null;
    }
    const conversation = (await response.json()) as AiConversation;
    if (shouldDetach) detachActiveRun();
    setConversations((prev) => [conversation, ...prev]);
    setActiveConversationId(conversation.id);
    setMessages([]);
    resumedTurnId = null;
    setActiveTurn(null);
    setRunStatus("idle");
    clearPendingActions();
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
    if (content.length === 0 || running() || activeTurn()) return false;

    const controller = new AbortController();
    const thisRun = ++runId;
    let completed = false;
    setError(null);
    setRunStatus("sending");
    clearAssistantOutput();
    resetResumeRetry();
    clearPendingActions();
    setStreamController(controller);

    try {
      const conversationId = await ensureConversation();
      if (!conversationId) return false;
      setMessages((prev) => [...prev, tempUserMessage(conversationId, content)]);

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
      if (thisRun === runId) setRunStatus("streaming");
      completed = await consumeStream(response, conversationId, false);
      if (thisRun !== runId) return false;
      if (completed) await waitForAssistantOutputSettled();
      await refreshConversationDetail(conversationId);
      await refreshConversations();
      return true;
    } catch (sendError) {
      if (thisRun === runId) {
        setRunStatus("failed");
        setError(controller.signal.aborted ? "AI request stopped." : sendError instanceof Error ? sendError.message : "AI request failed");
      }
      return false;
    } finally {
      if (activeAbortController === controller) setStreamController(null);
      if (thisRun === runId) {
        if (runStatus() !== "failed") setRunning(false);
        const turnAfterRefresh = activeTurn();
        if (completed || !turnAfterRefresh) {
          resetResumeRetry();
          clearAssistantOutput();
        } else {
          flushAssistantOutput();
          scheduleResumeRetry(turnAfterRefresh);
        }
      }
    }
  };

  const forkMessage = async (messageId: string, input: { title?: string } = {}) => {
    const conversationId = activeConversationId();
    if (!conversationId || running()) return null;

    setError(null);
    const response = await options.route.conversations[":conversationId"].messages[":messageId"].fork.$post(
      inputWithParams({ param: { conversationId, messageId }, json: input }),
    );
    if (!response.ok) {
      setError(await readAiError(response, "Failed to fork conversation"));
      return null;
    }

    const detail = (await response.json()) as AiConversationDetail;
    setConversations((prev) => [detail.conversation, ...prev.filter((conversation) => conversation.id !== detail.conversation.id)]);
    setActiveConversationId(detail.conversation.id);
    setMessages(detail.messages);
    resumedTurnId = null;
    setActiveTurn(
      detail.activeTurn ? { conversationId: detail.conversation.id, turnId: detail.activeTurn.id, loopId: detail.activeTurn.id } : null,
    );
    if (!detail.activeTurn) setRunStatus("idle");
    applyPendingActions(detail.pendingActions);
    await refreshConversations().catch(() => undefined);
    return detail.conversation;
  };

  const retryUserMessage = async (
    messageId: string,
    input: { content?: AiUserContentPart[]; mode?: AiMessageRetryMode; modelProfileId?: string } = {},
  ): Promise<boolean> => {
    const conversationId = activeConversationId();
    if (!conversationId) return false;
    if (running()) {
      setError("Stop the current response before trying again.");
      return false;
    }

    const currentMessages = messages();
    const target = currentMessages.find((message) => message.id === messageId);
    if (!target || target.kind !== "message" || target.message.role !== "user") {
      setError("Could not find a user message to retry.");
      return false;
    }
    const content = input.content?.length ? input.content : target.message.content;
    const currentActiveTurn = activeTurn();
    const currentAssistantDraft = assistantDraft();
    const currentAssistantThinkingDraft = assistantThinkingDraft();
    const currentAssistantBlocks = assistantBlocks();
    const currentApprovalRequests = approvalRequests();
    const currentFrontendToolRequests = frontendToolRequests();
    const currentResumedTurnId = resumedTurnId;

    const controller = new AbortController();
    const thisRun = ++runId;
    let completed = false;
    setError(null);
    setRunStatus("sending");
    resetResumeRetry();
    resumedTurnId = null;
    setActiveTurn(null);
    clearAssistantOutput();
    clearPendingActions();
    setStreamController(controller);
    setMessages([...currentMessages.filter((message) => message.seq < target.seq), tempUserMessage(conversationId, content)]);

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
      if (thisRun === runId) setRunStatus("streaming");
      completed = await consumeStream(response, conversationId, false);
      if (thisRun !== runId) return false;
      if (completed) await waitForAssistantOutputSettled();
      await refreshConversationDetail(conversationId);
      await refreshConversations();
      return true;
    } catch (retryError) {
      if (thisRun === runId) {
        setRunStatus("failed");
        setMessages(currentMessages);
        setActiveTurn(currentActiveTurn);
        setAssistantDraft(currentAssistantDraft);
        setAssistantThinkingDraft(currentAssistantThinkingDraft);
        setAssistantBlocks(currentAssistantBlocks);
        setApprovalRequests(currentApprovalRequests);
        setFrontendToolRequests(currentFrontendToolRequests);
        resumedTurnId = currentResumedTurnId;
        setError(controller.signal.aborted ? "AI request stopped." : retryError instanceof Error ? retryError.message : "AI retry failed");
      }
      return false;
    } finally {
      if (activeAbortController === controller) setStreamController(null);
      if (thisRun === runId) {
        if (runStatus() !== "failed") setRunning(false);
        const turnAfterRefresh = activeTurn();
        if (completed || !turnAfterRefresh) {
          resetResumeRetry();
          clearAssistantOutput();
        } else {
          flushAssistantOutput();
          scheduleResumeRetry(turnAfterRefresh);
        }
      }
    }
  };

  const submitTurnAction = async (input: {
    conversationId: string;
    turnId: string;
    callId: string;
    action: TurnActionInput;
  }): Promise<boolean> => {
    const response = await options.route.conversations[":conversationId"].turns[":turnId"].actions[":callId"].$post(
      inputWithParams({
        param: { conversationId: input.conversationId, turnId: input.turnId, callId: input.callId },
        json: input.action,
      }),
    );
    if (!response.ok) {
      setError(await readAiError(response, "Failed to continue AI turn"));
      return false;
    }
    const remainingActionCount =
      approvalRequests().filter((request) => request.callId !== input.callId).length +
      frontendToolRequests().filter((request) => request.callId !== input.callId).length;
    setApprovalRequests((prev) => prev.filter((request) => request.callId !== input.callId));
    setFrontendToolRequests((prev) => prev.filter((request) => request.callId !== input.callId));
    const turn = activeTurn();
    if (turn && turn.conversationId === input.conversationId && turn.turnId === input.turnId) {
      if (remainingActionCount > 0) setRunStatus("waiting_for_action");
      else if (activeAbortController && !activeAbortController.signal.aborted) setRunStatus("streaming");
      else void resume(turn);
    }
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
      const blockId = `approval-${eventLoopId(request)}-${request.callId}`;
      upsertAssistantBlock(
        { id: blockId, type: "approval_request", request, status: input.approved ? "approved" : "rejected" },
        (block) => block.id === blockId,
      );
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
      const blockId = `frontend-${eventLoopId(request)}-${request.callId}`;
      upsertAssistantBlock(
        { id: blockId, type: "frontend_tool", request, status: "completed", result },
        (block) => block.id === blockId,
      );
      return true;
    });

  if (options.initialPendingActions?.length) {
    queueMicrotask(() => applyPendingActions(options.initialPendingActions));
  }

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
