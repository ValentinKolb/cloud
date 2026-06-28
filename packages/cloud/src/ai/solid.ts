import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { parseAiSse, readAiError } from "./browser";
import type { AiConversation, AiPendingTurnAction, AiSseEvent, AiStoredMessage, AiTurn, AiUiBlock, AiUserContentPart } from "./types";

type ActiveTurn = {
  conversationId: string;
  turnId: string;
  cursor?: string;
};

type ApprovalRequest = Extract<AiSseEvent, { type: "approval_request" }>;
type FrontendToolRequest = Extract<AiSseEvent, { type: "frontend_tool" }>;

export type AiApprovalRequest = ApprovalRequest;
export type AiFrontendToolRequest = FrontendToolRequest;
export type AiFrontendToolHandler = (request: AiFrontendToolRequest) => unknown | Promise<unknown>;

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
  createdAt: new Date().toISOString(),
});

const tempAssistantMessage = (conversationId: string, message: AiStoredMessage["message"]): AiStoredMessage => ({
  id: `tmp-assistant-${Date.now()}`,
  conversationId,
  seq: Date.now(),
  kind: "message",
  message,
  modelProfileId: null,
  providerModel: null,
  usage: null,
  stopReason: null,
  createdAt: new Date().toISOString(),
});

const isAccessor = <T>(value: T | Accessor<T>): value is Accessor<T> => typeof value === "function";

const isApprovalRequest = (action: AiPendingTurnAction): action is ApprovalRequest => action.type === "approval_request";

const isFrontendToolRequest = (action: AiPendingTurnAction): action is FrontendToolRequest => action.type === "frontend_tool";

const pendingActionToUiBlock = (action: AiPendingTurnAction): AiUiBlock =>
  action.type === "approval_request"
    ? { id: `approval-${action.callId}`, type: "approval_request", request: action, status: "pending" }
    : { id: `frontend-${action.callId}`, type: "frontend_tool", request: action, status: "pending" };

const ASSISTANT_DRAFT_CHARS_PER_TICK = 8;
const ASSISTANT_DRAFT_TICK_MS = 32;
const ASSISTANT_DRAFT_MAX_DRAIN_MS = 3_000;

export const createAiChatController = <TRoute extends AiChatRouteBranch>(options: CreateAiChatControllerOptions<TRoute>) => {
  const [conversations, setConversations] = createSignal(options.initialConversations ?? []);
  const [activeConversationId, setActiveConversationId] = createSignal<string | null>(options.initialConversationId ?? null);
  const [messages, setMessages] = createSignal(options.initialMessages ?? []);
  const [assistantDraft, setAssistantDraft] = createSignal("");
  const [assistantThinkingDraft, setAssistantThinkingDraft] = createSignal("");
  const [assistantBlocks, setAssistantBlocks] = createSignal<AiUiBlock[]>((options.initialPendingActions ?? []).map(pendingActionToUiBlock));
  const [running, setRunning] = createSignal(false);
  const [error, setError] = createSignal<string | null>(options.initialError ?? null);
  const [approvalRequests, setApprovalRequests] = createSignal<ApprovalRequest[]>(
    (options.initialPendingActions ?? []).filter(isApprovalRequest),
  );
  const [frontendToolRequests, setFrontendToolRequests] = createSignal<FrontendToolRequest[]>(
    (options.initialPendingActions ?? []).filter(isFrontendToolRequest),
  );
  const [activeTurn, setActiveTurn] = createSignal<ActiveTurn | null>(
    options.initialConversationId && options.initialActiveTurn
      ? { conversationId: options.initialConversationId, turnId: options.initialActiveTurn.id }
      : null,
  );

  let activeAbortController: AbortController | null = null;
  let resumedTurnId: string | null = null;
  let resumeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let resumeRetryDelayMs = 1_000;
  let assistantDeltaQueue = "";
  let assistantDeltaTimer: ReturnType<typeof setTimeout> | null = null;
  let assistantDeltaDrainStartedAt: number | null = null;
  let pendingAssistantFinal: { conversationId: string; message: AiStoredMessage["message"] } | null = null;
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
    setMessages((prev) => [...prev, tempAssistantMessage(final.conversationId, final.message)]);
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

    void options.route.conversations[":conversationId"].turns[":turnId"].abort
      .$post(inputWithParams({ param: { conversationId: turn.conversationId, turnId: turn.turnId } }))
      .then(async (response) => {
        if (!response.ok) {
          setError(await readAiError(response, "Failed to stop AI turn"));
        }
      })
      .catch((abortError) => {
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
    setActiveTurn(body.activeTurn ? { conversationId, turnId: body.activeTurn.id } : null);
    applyPendingActions(body.pendingActions);
  };

  const handleStreamEvent = (event: AiSseEvent, conversationId: string): boolean => {
    resetResumeRetry();

    if (event.cursor) {
      setActiveTurn((prev) => (prev && prev.turnId === event.turnId ? { ...prev, cursor: event.cursor } : prev));
    }

    if (event.type === "turn_start") {
      setActiveTurn({ conversationId, turnId: event.turnId, cursor: event.cursor });
      setAssistantBlocks([]);
      return false;
    }

    if (event.type === "done") {
      setActiveTurn(null);
      return true;
    }

    if (event.type === "error") {
      setError(event.message);
      upsertAssistantBlock({ id: `error-${event.turnId}`, type: "error", message: event.message });
      setActiveTurn(null);
      return true;
    }

    if (event.type === "approval_request") {
      setApprovalRequests((prev) => [...prev.filter((request) => request.callId !== event.callId), event]);
      upsertAssistantBlock(
        { id: `approval-${event.callId}`, type: "approval_request", request: event, status: "pending" },
        (block) => block.type === "approval_request" && block.request.callId === event.callId,
      );
      return false;
    }

    if (event.type === "frontend_tool") {
      setFrontendToolRequests((prev) => [...prev.filter((request) => request.callId !== event.callId), event]);
      upsertAssistantBlock(
        { id: `frontend-${event.callId}`, type: "frontend_tool", request: event, status: "pending" },
        (block) => block.type === "frontend_tool" && block.request.callId === event.callId,
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
      updateToolBlock(nessiEvent.callId, { name: nessiEvent.name, status: "running" });
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
      upsertAssistantBlock({ id: "compaction", type: "compaction", status: "running" });
    } else if (nessiEvent.type === "compaction_end") {
      upsertAssistantBlock({ id: "compaction", type: "compaction", status: "completed" });
    } else if (nessiEvent.type === "turn_end") {
      if (pendingAssistantFinal) flushAssistantOutput();
      pendingAssistantFinal = { conversationId, message: nessiEvent.message };
      if (!assistantDeltaQueue && !assistantDeltaTimer) commitPendingAssistantFinal();
    } else if (nessiEvent.type === "error") {
      setError(nessiEvent.error);
      upsertAssistantBlock({ id: `error-${event.turnId}`, type: "error", message: nessiEvent.error });
    }
    return false;
  };

  async function runFrontendTool(request: FrontendToolRequest) {
    const handler = options.frontendTools?.[request.name];
    const canAutoAcknowledgeView = request.mode === "client_view" && request.name === "cloud_card";
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
    setRunning(true);
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
      completed = await consumeStream(response, turn.conversationId, true);
      if (thisRun !== runId) return;
      if (completed) await waitForAssistantOutputSettled();
      await refreshConversationDetail(turn.conversationId);
      if (completed) setActiveTurn(null);
      await refreshConversations();
    } catch (resumeError) {
      if (controller.signal.aborted || thisRun !== runId) return;
      setError(resumeError instanceof Error ? resumeError.message : "Failed to resume AI stream");
    } finally {
      if (activeAbortController === controller) setStreamController(null);
      if (thisRun === runId) {
        setRunning(false);
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
    if (running()) return;
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
    setActiveConversationId(detail.conversation.id);
    setMessages(detail.messages);
    resumedTurnId = null;
    setActiveTurn(detail.activeTurn ? { conversationId: detail.conversation.id, turnId: detail.activeTurn.id } : null);
    applyPendingActions(detail.pendingActions);
  };

  const createConversation = async (input: { title?: string } = {}) => {
    resetResumeRetry();
    clearAssistantOutput();
    const response = await options.route.conversations.$post(inputWithParams({ json: input }));
    if (!response.ok) {
      setError(await readAiError(response, "Failed to create conversation"));
      return null;
    }
    const conversation = (await response.json()) as AiConversation;
    setConversations((prev) => [conversation, ...prev]);
    setActiveConversationId(conversation.id);
    setMessages([]);
    resumedTurnId = null;
    setActiveTurn(null);
    clearPendingActions();
    return conversation;
  };

  const ensureConversation = async () => {
    const current = activeConversationId();
    if (current) return current;
    const conversation = await createConversation();
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
    setRunning(true);
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
      completed = await consumeStream(response, conversationId, false);
      if (thisRun !== runId) return false;
      if (completed) await waitForAssistantOutputSettled();
      await refreshConversationDetail(conversationId);
      await refreshConversations();
      return true;
    } catch (sendError) {
      if (thisRun === runId) {
        setError(controller.signal.aborted ? "AI request stopped." : sendError instanceof Error ? sendError.message : "AI request failed");
      }
      return false;
    } finally {
      if (activeAbortController === controller) setStreamController(null);
      if (thisRun === runId) {
        setRunning(false);
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
    setApprovalRequests((prev) => prev.filter((request) => request.callId !== input.callId));
    setFrontendToolRequests((prev) => prev.filter((request) => request.callId !== input.callId));
    const turn = activeTurn();
    if (turn && turn.conversationId === input.conversationId && turn.turnId === input.turnId && !running()) {
      void resume(turn);
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
      upsertAssistantBlock(
        { id: `approval-${request.callId}`, type: "approval_request", request, status: input.approved ? "approved" : "rejected" },
        (block) => block.type === "approval_request" && block.request.callId === request.callId,
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
      upsertAssistantBlock(
        { id: `frontend-${request.callId}`, type: "frontend_tool", request, status: "completed", result },
        (block) => block.type === "frontend_tool" && block.request.callId === request.callId,
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
    resume,
    resumeActiveTurn,
    submitTurnAction,
    respondToApproval,
    submitFrontendToolResult,
  };
};

export type AiChatController = ReturnType<typeof createAiChatController>;
