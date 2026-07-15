import type {
  AiConversation,
  AiConversationPage,
  AiConversationStatusFilter,
  AiEnrichmentRun,
  AiEnrichmentStatus,
  AiUserPrefs,
} from "@valentinkolb/cloud/ai";

const BASE = "/api/assistant";

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : fallback;
};

/** Minimal typed client for the conversation-management endpoints used by the sidebar/editor. */
export const assistantApi = {
  listConversations: async (input: {
    q?: string;
    limit?: number;
    archived?: boolean;
    status?: AiConversationStatusFilter;
    signal?: AbortSignal;
  }): Promise<AiConversation[]> => {
    const params = new URLSearchParams();
    if (input.q) params.set("q", input.q);
    if (input.limit) params.set("limit", String(input.limit));
    if (input.archived) params.set("archived", "true");
    if (input.status) params.set("status", input.status);
    const response = await fetch(`${BASE}/conversations?${params.toString()}`, { signal: input.signal });
    if (!response.ok) throw new Error(await readError(response, "Failed to search chats"));
    return (await response.json()) as AiConversation[];
  },

  listConversationsPage: async (input: {
    q?: string;
    page: number;
    perPage?: number;
    archived?: boolean;
    status?: AiConversationStatusFilter;
    signal?: AbortSignal;
  }): Promise<AiConversationPage> => {
    const params = new URLSearchParams({ page: String(input.page), perPage: String(input.perPage ?? 20) });
    if (input.q) params.set("q", input.q);
    if (input.archived) params.set("archived", "true");
    if (input.status) params.set("status", input.status);
    const response = await fetch(`${BASE}/conversations/page?${params.toString()}`, { signal: input.signal });
    if (!response.ok) throw new Error(await readError(response, "Failed to load chats"));
    return (await response.json()) as AiConversationPage;
  },

  createConversation: async (input: { title?: string } = {}): Promise<AiConversation> => {
    const response = await fetch(`${BASE}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readError(response, "Failed to create chat"));
    return (await response.json()) as AiConversation;
  },

  updateConversation: async (
    conversationId: string,
    input: { title: string; icon?: string; description?: string; pinned?: boolean },
  ): Promise<AiConversation> => {
    const response = await fetch(`${BASE}/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readError(response, "Failed to save chat"));
    return (await response.json()) as AiConversation;
  },

  getSystemPromptPreview: async (): Promise<{ prompt: string; renderedAt: string }> => {
    const response = await fetch(`${BASE}/prefs/system-prompt`);
    if (!response.ok) throw new Error(await readError(response, "Failed to load system prompt"));
    return (await response.json()) as { prompt: string; renderedAt: string };
  },

  getPrefs: async (): Promise<AiUserPrefs> => {
    const response = await fetch(`${BASE}/prefs`);
    if (!response.ok) throw new Error(await readError(response, "Failed to load AI preferences"));
    return (await response.json()) as AiUserPrefs;
  },

  updatePrefs: async (input: { instructions?: string; memory?: string; memoryEnabled?: boolean }): Promise<AiUserPrefs> => {
    const response = await fetch(`${BASE}/prefs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readError(response, "Failed to save AI preferences"));
    return (await response.json()) as AiUserPrefs;
  },

  setConversationPinned: async (conversationId: string, pinned: boolean): Promise<AiConversation> => {
    const response = await fetch(`${BASE}/conversations/${conversationId}/pin`, { method: pinned ? "POST" : "DELETE" });
    if (!response.ok) throw new Error(await readError(response, pinned ? "Failed to pin chat" : "Failed to unpin chat"));
    return (await response.json()) as AiConversation;
  },

  archiveConversation: async (conversationId: string): Promise<void> => {
    const response = await fetch(`${BASE}/conversations/${conversationId}/archive`, { method: "POST" });
    if (!response.ok) throw new Error(await readError(response, "Failed to archive chat"));
  },

  restoreConversation: async (conversationId: string): Promise<AiConversation> => {
    const response = await fetch(`${BASE}/conversations/${conversationId}/restore`, { method: "POST" });
    if (!response.ok) throw new Error(await readError(response, "Failed to restore chat"));
    return (await response.json()) as AiConversation;
  },

  getEnrichment: async (conversationId: string): Promise<{ status: AiEnrichmentStatus | null; runs: AiEnrichmentRun[] }> => {
    const response = await fetch(`${BASE}/conversations/${conversationId}/enrichment`);
    if (!response.ok) throw new Error(await readError(response, "Failed to load index status"));
    return (await response.json()) as { status: AiEnrichmentStatus | null; runs: AiEnrichmentRun[] };
  },

  reindexConversation: async (conversationId: string): Promise<void> => {
    const response = await fetch(`${BASE}/conversations/${conversationId}/reindex`, { method: "POST" });
    if (!response.ok) throw new Error(await readError(response, "Failed to queue reindex"));
  },
};
