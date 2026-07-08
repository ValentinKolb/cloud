import { type Accessor, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { AiStreamSseEvent, AiTurnSnapshot } from "../protocol";
import type { AiConversation, AiStoredMessage, AiTurn, AiUserContentPart } from "../types";
import { type AiActiveTurn, type AiChatProjection, activeTurnFromSnapshot, emptyProjection, reduceProjection, visibleMessages } from "./projection";
import { type AiStreamHandle, subscribeAiStream } from "./transport";

export type AiChatRunStatus = "idle" | "streaming" | "waiting_for_action" | "stopping" | "failed";
export type AiStreamStatus = "idle" | "connecting" | "open" | "reconnecting";

export type AiFrontendToolHandler = (request: { name: string; callId: string; args: unknown; turnId: string }) => unknown | Promise<unknown>;

type AiConversationDetail = { conversation: AiConversation; messages: AiStoredMessage[]; activeTurn: AiTurnSnapshot | null };
type SubmitTurnResult = { turn: AiTurn; message: AiStoredMessage };

const detailToProjection = (detail: AiConversationDetail): AiChatProjection => ({
  conversation: detail.conversation,
  messages: detail.messages,
  activeTurn: activeTurnFromSnapshot(detail.activeTurn),
});

export type CreateAiChatControllerOptions = {
  /** API base path, e.g. "/api/assistant". */
  baseUrl: string;
  params?: Record<string, string> | Accessor<Record<string, string>>;
  initialConversations?: AiConversation[];
  initialConversationId?: string | null;
  initialDetail?: AiConversationDetail | null;
  initialError?: string | null;
  frontendTools?: Record<string, AiFrontendToolHandler>;
};

const isAccessor = <T>(value: T | Accessor<T>): value is Accessor<T> => typeof value === "function";

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : fallback;
};

export const createAiChatController = (options: CreateAiChatControllerOptions) => {
  const [conversations, setConversations] = createSignal(options.initialConversations ?? []);
  const [activeConversationId, setActiveConversationIdSignal] = createSignal<string | null>(options.initialConversationId ?? null);
  const [globalError, setGlobalError] = createSignal<string | null>(options.initialError ?? null);
  const [runStatusRaw, setRunStatusRaw] = createSignal<AiChatRunStatus | null>(null);
  const [streamStatus, setStreamStatus] = createSignal<AiStreamStatus>("idle");
  const [state, setState] = createStore<AiChatProjection>(options.initialDetail ? detailToProjection(options.initialDetail) : emptyProjection());

  // Cache of projections for conversations opened this session (fast switching).
  const cache = new Map<string, AiChatProjection>();
  const handledFrontendCalls = new Set<string>();
  let stream: AiStreamHandle | null = null;
  let streamConversationId: string | null = null;

  const currentParams = () => (options.params ? (isAccessor(options.params) ? options.params() : options.params) : {});
  const queryString = () => {
    const params = currentParams();
    const query = new URLSearchParams(params).toString();
    return query ? `?${query}` : "";
  };
  const url = (path: string, extra?: Record<string, string>) => {
    const params = new URLSearchParams({ ...currentParams(), ...extra }).toString();
    return `${options.baseUrl}${path}${params ? `?${params}` : ""}`;
  };

  const request = async <T>(path: string, init: RequestInit, fallback: string): Promise<T> => {
    const response = await fetch(url(path), { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
    if (!response.ok) throw new Error(await readError(response, fallback));
    return (await response.json()) as T;
  };

  const setActiveError = (message: string | null) => {
    if (activeConversationId()) setGlobalError(message);
    else setGlobalError(message);
  };
  const error = () => globalError();

  const activeTurn = () => state.activeTurn;
  const messages = createMemo(() => visibleMessages(state));
  const runStatus = (): AiChatRunStatus => {
    const override = runStatusRaw();
    if (override) return override;
    const turn = state.activeTurn;
    if (!turn) return "idle";
    return turn.status === "waiting_for_action" ? "waiting_for_action" : "streaming";
  };
  const running = () => {
    const status = runStatus();
    return status === "streaming" || status === "waiting_for_action" || status === "stopping";
  };

  // ---- streaming --------------------------------------------------------

  const reduceEvent = (conversationId: string, event: AiStreamSseEvent) => {
    const next = reduceProjection({ conversation: state.conversation, messages: state.messages, activeTurn: state.activeTurn }, event);
    setState(reconcile(next, { key: "id", merge: true }));
    cache.set(conversationId, next);
  };

  /**
   * Compaction rewrites history (archives messages, inserts the summary) — the
   * additive event fold cannot express that, so the turn ends with one atomic
   * detail refetch. The finished compaction block stays visible until the fresh
   * state replaces it in a single step.
   */
  const foldCompaction = async (conversationId: string, event: AiStreamSseEvent) => {
    const detail = await loadDetail(conversationId);
    if (streamConversationId !== conversationId) return;
    if (detail) setProjection(detailToProjection(detail), conversationId);
    else reduceEvent(conversationId, event);
    setRunStatusRaw(null);
    void refreshConversations();
  };

  const applyEvent = (conversationId: string, event: AiStreamSseEvent) => {
    if (streamConversationId !== conversationId) return;

    if (
      event.type === "turn_finished" &&
      state.activeTurn?.turnId === event.turnId &&
      state.activeTurn.blocks.some((block) => block.kind === "compaction")
    ) {
      void foldCompaction(conversationId, event);
      return;
    }

    reduceEvent(conversationId, event);
    if (runStatusRaw() && runStatusRaw() !== "stopping") setRunStatusRaw(null);

    if (event.type === "turn_finished") {
      setRunStatusRaw(null);
      void refreshConversations();
    }
    runFrontendTools();
  };

  const closeStream = () => {
    stream?.close();
    stream = null;
    streamConversationId = null;
    setStreamStatus("idle");
  };

  const openStream = (conversationId: string) => {
    if (streamConversationId === conversationId && stream) return;
    closeStream();
    streamConversationId = conversationId;
    stream = subscribeAiStream({
      url: url(`/conversations/${conversationId}/stream`),
      onStatus: setStreamStatus,
      onEvent: (event) => applyEvent(conversationId, event),
    });
  };

  // ---- frontend tools ---------------------------------------------------

  const runFrontendTools = () => {
    const turn = state.activeTurn;
    if (!turn || turn.status !== "waiting_for_action") return;
    for (const block of turn.blocks) {
      if (block.kind !== "tool" || block.status !== "awaiting_client") continue;
      const mode = block.frontendMode ?? "client";
      if (mode === "client_interaction") continue; // handled by the rendered UI (e.g. survey)
      const key = `${turn.turnId}:${block.callId}`;
      if (handledFrontendCalls.has(key)) continue;
      handledFrontendCalls.add(key);
      void executeFrontendTool(turn.turnId, block.callId, block.name, block.args, mode === "client_view");
    }
  };

  const executeFrontendTool = async (turnId: string, callId: string, name: string, args: unknown, viewOnly: boolean) => {
    const handler = options.frontendTools?.[name];
    try {
      const result = viewOnly || !handler ? { displayed: true } : await handler({ name, callId, args, turnId });
      await submitTurnAction(turnId, callId, { type: "tool_result", result });
    } catch (toolError) {
      await submitTurnAction(turnId, callId, { type: "tool_result", result: { error: toolError instanceof Error ? toolError.message : "Frontend tool failed" } });
    }
  };

  // ---- conversation loading --------------------------------------------

  const refreshConversations = async () => {
    try {
      const list = await request<AiConversation[]>(`/conversations`, { method: "GET" }, "Failed to load conversations");
      setConversations(list);
    } catch (loadError) {
      setGlobalError(loadError instanceof Error ? loadError.message : "Failed to load conversations");
    }
  };

  const loadDetail = async (conversationId: string): Promise<AiConversationDetail | null> => {
    try {
      return await request<AiConversationDetail>(`/conversations/${conversationId}`, { method: "GET" }, "Failed to open conversation");
    } catch (loadError) {
      setGlobalError(loadError instanceof Error ? loadError.message : "Failed to open conversation");
      return null;
    }
  };

  const setProjection = (projection: AiChatProjection, conversationId: string) => {
    cache.set(conversationId, projection);
    setState(reconcile(projection, { key: "id", merge: true }));
  };

  const openConversation = async (conversationId: string) => {
    setGlobalError(null);
    setRunStatusRaw(null);
    handledFrontendCalls.clear();
    setActiveConversationIdSignal(conversationId);

    const cached = cache.get(conversationId);
    if (cached) setState(reconcile(cached, { key: "id", merge: true }));

    openStream(conversationId);
    const detail = await loadDetail(conversationId);
    if (detail && activeConversationId() === conversationId) {
      setProjection(detailToProjection(detail), conversationId);
      runFrontendTools();
    }
  };

  const setActiveConversationId = (conversationId: string | null) => {
    if (conversationId) void openConversation(conversationId);
    else {
      setActiveConversationIdSignal(null);
      closeStream();
      setState(reconcile(emptyProjection(), { key: "id", merge: true }));
    }
  };

  const createConversation = async (input: { title?: string } = {}) => {
    try {
      const conversation = await request<AiConversation>(`/conversations`, { method: "POST", body: JSON.stringify(input) }, "Failed to create conversation");
      setConversations((prev) => [conversation, ...prev.filter((item) => item.id !== conversation.id)]);
      setProjection(emptyProjection(conversation), conversation.id);
      setActiveConversationIdSignal(conversation.id);
      handledFrontendCalls.clear();
      openStream(conversation.id);
      return conversation;
    } catch (createError) {
      setGlobalError(createError instanceof Error ? createError.message : "Failed to create conversation");
      return null;
    }
  };

  const ensureConversation = async (): Promise<string | null> => activeConversationId() ?? (await createConversation())?.id ?? null;

  // ---- commands ---------------------------------------------------------

  const send = async (input: { message?: string; content?: AiUserContentPart[]; modelProfileId?: string }) => {
    const text = input.message?.trim() ?? "";
    if (!text && !input.content?.length) return false;
    const conversationId = await ensureConversation();
    if (!conversationId) return false;
    if (running()) return false;

    // Optimistic: show the user message immediately.
    const optimistic: AiStoredMessage = {
      id: `pending-${Date.now()}`,
      conversationId,
      seq: (state.messages.at(-1)?.seq ?? 0) + 1,
      kind: "message",
      message: { role: "user", content: input.content?.length ? input.content : [{ type: "text", text }] },
      loopId: null,
      modelProfileId: null,
      providerModel: null,
      usage: null,
      stopReason: null,
      loopAggregate: null,
      loopDoneReason: null,
      compactedAt: null,
      meta: null,
      createdAt: new Date().toISOString(),
    };
    setState("messages", (prev) => [...prev, optimistic]);
    setRunStatusRaw("streaming");
    setGlobalError(null);

    try {
      const result = await request<SubmitTurnResult>(
        `/conversations/${conversationId}/turns`,
        { method: "POST", body: JSON.stringify({ message: text || undefined, content: input.content?.length ? input.content : undefined, modelProfileId: input.modelProfileId }) },
        "AI request failed",
      );
      // Replace the optimistic message with the persisted one.
      setState("messages", (prev) => prev.map((message) => (message.id === optimistic.id ? result.message : message)));
      cache.set(conversationId, { conversation: state.conversation, messages: state.messages, activeTurn: state.activeTurn });
      return true;
    } catch (sendError) {
      setState("messages", (prev) => prev.filter((message) => message.id !== optimistic.id));
      setRunStatusRaw("failed");
      setGlobalError(sendError instanceof Error ? sendError.message : "AI request failed");
      return false;
    }
  };

  const abort = () => {
    const turn = state.activeTurn;
    const conversationId = activeConversationId();
    if (!turn || !conversationId) return;
    setRunStatusRaw("stopping");
    void request(`/conversations/${conversationId}/turns/${turn.turnId}/abort`, { method: "POST" }, "Failed to stop AI turn")
      .then(() => void refreshConversations())
      .catch((abortError) => {
        setRunStatusRaw("failed");
        setGlobalError(abortError instanceof Error ? abortError.message : "Failed to stop AI turn");
      });
  };

  const compactConversation = async (input: { modelProfileId?: string } = {}) => {
    const conversationId = activeConversationId();
    if (!conversationId) {
      setGlobalError("Open a chat before compacting context.");
      return false;
    }
    if (running()) {
      setGlobalError("Stop the current response before compacting context.");
      return false;
    }
    setRunStatusRaw("streaming");
    try {
      await request(`/conversations/${conversationId}/compact`, { method: "POST", body: JSON.stringify(input) }, "AI compaction failed");
      return true;
    } catch (compactError) {
      setRunStatusRaw("failed");
      setGlobalError(compactError instanceof Error ? compactError.message : "AI compaction failed");
      return false;
    }
  };

  const retryUserMessage = async (messageId: string, input: { content?: AiUserContentPart[]; mode?: "retry" | "details" | "concise"; modelProfileId?: string } = {}) => {
    const conversationId = activeConversationId();
    if (!conversationId || running()) return false;
    setRunStatusRaw("streaming");
    setGlobalError(null);
    try {
      const result = await request<SubmitTurnResult>(
        `/conversations/${conversationId}/messages/${messageId}/retry`,
        { method: "POST", body: JSON.stringify({ mode: input.mode ?? "retry", content: input.content, modelProfileId: input.modelProfileId }) },
        "AI retry failed",
      );
      // Truncate the client view to before the retried message, then show the new one.
      setState("messages", (prev) => [...prev.filter((message) => message.seq < result.message.seq), result.message]);
      return true;
    } catch (retryError) {
      setRunStatusRaw("failed");
      setGlobalError(retryError instanceof Error ? retryError.message : "AI retry failed");
      return false;
    }
  };

  const forkMessage = async (messageId: string, input: { title?: string } = {}) => {
    const conversationId = activeConversationId();
    if (!conversationId) return null;
    try {
      const detail = await request<AiConversationDetail>(
        `/conversations/${conversationId}/messages/${messageId}/fork`,
        { method: "POST", body: JSON.stringify(input) },
        "Failed to fork conversation",
      );
      setConversations((prev) => [detail.conversation, ...prev.filter((item) => item.id !== detail.conversation.id)]);
      setProjection(detailToProjection(detail), detail.conversation.id);
      setActiveConversationIdSignal(detail.conversation.id);
      openStream(detail.conversation.id);
      return detail.conversation;
    } catch (forkError) {
      setGlobalError(forkError instanceof Error ? forkError.message : "Failed to fork conversation");
      return null;
    }
  };

  const submitTurnAction = async (turnId: string, callId: string, action: { type: "approval_response"; approved: boolean; remember?: "always" } | { type: "tool_result"; result: unknown }) => {
    const conversationId = activeConversationId();
    if (!conversationId) return false;
    try {
      await request(`/conversations/${conversationId}/turns/${turnId}/actions/${callId}`, { method: "POST", body: JSON.stringify(action) }, "Failed to continue AI turn");
      return true;
    } catch (actionError) {
      setGlobalError(actionError instanceof Error ? actionError.message : "Failed to continue AI turn");
      return false;
    }
  };

  const respondToApproval = (request: { turnId: string; callId: string }, input: { approved: boolean; remember?: "always" }) =>
    submitTurnAction(request.turnId, request.callId, { type: "approval_response", approved: input.approved, remember: input.remember });

  const submitFrontendToolResult = (request: { turnId: string; callId: string }, result: unknown) =>
    submitTurnAction(request.turnId, request.callId, { type: "tool_result", result });

  if (options.initialConversationId) {
    openStream(options.initialConversationId);
    runFrontendTools();
  }

  onCleanup(() => closeStream());

  return {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    messages,
    activeTurn,
    runStatus,
    running,
    streamStatus,
    error,
    setError: setActiveError,
    refreshConversations,
    openConversation,
    createConversation,
    send,
    abort,
    compactConversation,
    retryUserMessage,
    forkMessage,
    submitTurnAction,
    respondToApproval,
    submitFrontendToolResult,
  };
};

export type AiChatController = ReturnType<typeof createAiChatController>;
