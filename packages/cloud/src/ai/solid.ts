import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { parseAiSse, readAiError } from "./browser";
import type { AiConversation, AiPendingTurnAction, AiSseEvent, AiStoredMessage, AiTurn } from "./types";

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

const messageText = (entry: AiStoredMessage["message"]): string => {
  if (entry.role === "tool_result") return typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result, null, 2);
  return entry.content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.type === "text") return part.text;
      return "";
    })
    .join("")
    .trim();
};

const tempMessage = (conversationId: string, role: "user" | "assistant", text: string): AiStoredMessage => ({
  id: `tmp-${role}-${Date.now()}`,
  conversationId,
  seq: Date.now(),
  kind: "message",
  message: { role, content: [{ type: "text", text }] },
  modelProfileId: null,
  providerModel: null,
  usage: null,
  stopReason: null,
  createdAt: new Date().toISOString(),
});

const isAccessor = <T>(value: T | Accessor<T>): value is Accessor<T> => typeof value === "function";

const isApprovalRequest = (action: AiPendingTurnAction): action is ApprovalRequest => action.type === "approval_request";

const isFrontendToolRequest = (action: AiPendingTurnAction): action is FrontendToolRequest => action.type === "frontend_tool";

export const createAiChatController = <TRoute extends AiChatRouteBranch>(options: CreateAiChatControllerOptions<TRoute>) => {
  const [conversations, setConversations] = createSignal(options.initialConversations ?? []);
  const [activeConversationId, setActiveConversationId] = createSignal<string | null>(options.initialConversationId ?? null);
  const [messages, setMessages] = createSignal(options.initialMessages ?? []);
  const [assistantDraft, setAssistantDraft] = createSignal("");
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
  let runId = 0;
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

  const applyPendingActions = (actions: AiPendingTurnAction[] | undefined) => {
    const pending = actions ?? [];
    const approvals = pending.filter(isApprovalRequest);
    const frontendTools = pending.filter(isFrontendToolRequest);
    setApprovalRequests(approvals);
    setFrontendToolRequests(frontendTools);
    for (const request of frontendTools) {
      if (request.mode === "client") void runFrontendTool(request);
    }
  };

  const abortStream = () => {
    activeAbortController?.abort();
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

  onCleanup(abortStream);

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
    if (event.cursor) {
      setActiveTurn((prev) => (prev && prev.turnId === event.turnId ? { ...prev, cursor: event.cursor } : prev));
    }

    if (event.type === "turn_start") {
      setActiveTurn({ conversationId, turnId: event.turnId, cursor: event.cursor });
      return false;
    }

    if (event.type === "done") {
      setActiveTurn(null);
      return true;
    }

    if (event.type === "error") {
      setError(event.message);
      setActiveTurn(null);
      return true;
    }

    if (event.type === "approval_request") {
      setApprovalRequests((prev) => [...prev.filter((request) => request.callId !== event.callId), event]);
      return false;
    }

    if (event.type === "frontend_tool") {
      setFrontendToolRequests((prev) => [...prev.filter((request) => request.callId !== event.callId), event]);
      if (event.mode === "client") void runFrontendTool(event);
      return false;
    }

    if (event.type !== "nessi") return false;
    const nessiEvent = event.event;
    if (nessiEvent.type === "text") {
      setAssistantDraft((prev) => prev + nessiEvent.delta);
    } else if (nessiEvent.type === "turn_end") {
      setAssistantDraft("");
      setMessages((prev) => [
        ...prev.filter((entry) => !entry.id.startsWith("tmp-assistant-")),
        tempMessage(conversationId, "assistant", messageText(nessiEvent.message)),
      ]);
    } else if (nessiEvent.type === "error") {
      setError(nessiEvent.error);
    }
    return false;
  };

  async function runFrontendTool(request: FrontendToolRequest) {
    const handler = options.frontendTools?.[request.name];
    if (!handler || handledFrontendToolCallIds.has(request.callId)) return;
    handledFrontendToolCallIds.add(request.callId);

    try {
      await submitFrontendToolResult(request, await handler(request));
    } catch (toolError) {
      const message = toolError instanceof Error ? toolError.message : "Frontend AI tool failed";
      setError(message);
      await submitFrontendToolResult(request, { error: message });
    }
  }

  createEffect(() => {
    for (const request of frontendToolRequests()) {
      if (request.mode === "client") void runFrontendTool(request);
    }
  });

  const consumeStream = async (response: Response, conversationId: string, stopOnFinal: boolean): Promise<boolean> => {
    for await (const event of parseAiSse(response)) {
      const final = handleStreamEvent(event, conversationId);
      if (final && stopOnFinal) return true;
    }
    return false;
  };

  const resume = async (turn: ActiveTurn) => {
    const controller = new AbortController();
    const thisRun = ++runId;
    setStreamController(controller);
    setRunning(true);
    setError(null);
    setAssistantDraft("");

    try {
      const response = await options.route.conversations[":conversationId"].turns[":turnId"].events.$get(
        inputWithParams({
          param: { conversationId: turn.conversationId, turnId: turn.turnId },
          query: { after: turn.cursor ?? "0-0" },
        }),
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await readAiError(response, "Failed to resume AI stream"));
      const final = await consumeStream(response, turn.conversationId, true);
      if (thisRun !== runId) return;
      await refreshConversationDetail(turn.conversationId);
      if (final) setActiveTurn(null);
      await refreshConversations();
    } catch (resumeError) {
      if (controller.signal.aborted || thisRun !== runId) return;
      setError(resumeError instanceof Error ? resumeError.message : "Failed to resume AI stream");
    } finally {
      if (activeAbortController === controller) setStreamController(null);
      if (thisRun === runId) {
        setRunning(false);
        setAssistantDraft("");
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
    setAssistantDraft("");
    applyPendingActions(detail.pendingActions);
  };

  const createConversation = async (input: { title?: string } = {}) => {
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
    setAssistantDraft("");
    clearPendingActions();
    return conversation;
  };

  const ensureConversation = async () => {
    const current = activeConversationId();
    if (current) return current;
    const conversation = await createConversation();
    return conversation?.id ?? null;
  };

  const send = async (input: { message: string; modelProfileId?: string }) => {
    const text = input.message.trim();
    if (!text || running() || activeTurn()) return false;

    const controller = new AbortController();
    const thisRun = ++runId;
    setError(null);
    setRunning(true);
    setAssistantDraft("");
    clearPendingActions();
    setStreamController(controller);

    try {
      const conversationId = await ensureConversation();
      if (!conversationId) return false;
      setMessages((prev) => [...prev, tempMessage(conversationId, "user", text)]);

      const response = await options.route.conversations[":conversationId"].turns.$post(
        inputWithParams({
          param: { conversationId },
          json: { message: text, modelProfileId: input.modelProfileId || undefined },
        }),
        { init: { signal: controller.signal } },
      );

      if (!response.ok) throw new Error(await readAiError(response, "AI request failed"));
      await consumeStream(response, conversationId, false);
      if (thisRun !== runId) return false;
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
        setAssistantDraft("");
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
    });

  const submitFrontendToolResult = (request: FrontendToolRequest, result: unknown) =>
    submitTurnAction({
      conversationId: request.conversationId,
      turnId: request.turnId,
      callId: request.callId,
      action: { type: "tool_result", result },
    });

  return {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    messages,
    assistantDraft,
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
