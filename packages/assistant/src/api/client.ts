import type {
  AiConversation,
  AiConversationPage,
  AiConversationStatusFilter,
  AiEnrichmentRun,
  AiEnrichmentStatus,
  AiMemory,
  AiMemoryKind,
  AiMemoryPriority,
  AiUserPrefs,
} from "@valentinkolb/cloud/ai";
import { api } from "@valentinkolb/cloud/browser";
import type { ApiType } from ".";

const client = api.create<ApiType>({ baseUrl: "/api/assistant" });

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : fallback;
};

/** Typed conversation-management facade used by the Assistant UI. */
export const assistantApi = {
  listConversations: async (input: {
    q?: string;
    limit?: number;
    archived?: boolean;
    status?: AiConversationStatusFilter;
    signal?: AbortSignal;
  }): Promise<AiConversation[]> => {
    const response = await client.conversations.$get(
      {
        query: {
          q: input.q,
          limit: input.limit ? String(input.limit) : undefined,
          archived: input.archived ? "true" : undefined,
          status: input.status,
        },
      },
      { init: { signal: input.signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to search chats"));
    return response.json();
  },

  listConversationsPage: async (input: {
    q?: string;
    page: number;
    perPage?: number;
    archived?: boolean;
    status?: AiConversationStatusFilter;
    signal?: AbortSignal;
  }): Promise<AiConversationPage> => {
    const response = await client.conversations.page.$get(
      {
        query: {
          q: input.q,
          page: String(input.page),
          perPage: String(input.perPage ?? 20),
          archived: input.archived ? "true" : undefined,
          status: input.status,
        },
      },
      { init: { signal: input.signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to load chats"));
    return response.json();
  },

  createConversation: async (input: { title?: string; projectId?: string } = {}): Promise<AiConversation> => {
    const response = await client.conversations.$post({ json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to create chat"));
    return response.json();
  },

  updateConversation: async (
    conversationId: string,
    input: { title: string; icon?: string; description?: string; pinned?: boolean },
  ): Promise<AiConversation> => {
    const response = await client.conversations[":conversationId"].$patch({ param: { conversationId }, json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to save chat"));
    return response.json();
  },

  getSystemPromptPreview: async (): Promise<{ prompt: string; renderedAt: string }> => {
    const response = await client.prefs["system-prompt"].$get();
    if (!response.ok) throw new Error(await readError(response, "Failed to load system prompt"));
    return response.json();
  },

  getPrefs: async (): Promise<AiUserPrefs> => {
    const response = await client.prefs.$get();
    if (!response.ok) throw new Error(await readError(response, "Failed to load AI preferences"));
    return response.json();
  },

  updatePrefs: async (input: { memoryEnabled?: boolean; memoryLearningEnabled?: boolean }): Promise<AiUserPrefs> => {
    const response = await client.prefs.$put({ json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to save AI preferences"));
    return response.json();
  },

  listMemories: async (input: { q?: string; limit?: number; signal?: AbortSignal } = {}): Promise<AiMemory[]> => {
    const response = await client.memories.$get(
      { query: { q: input.q, limit: input.limit ? String(input.limit) : undefined } },
      { init: { signal: input.signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to load memories"));
    return response.json();
  },

  createMemory: async (input: { kind: AiMemoryKind; content: string; priority?: AiMemoryPriority }): Promise<AiMemory> => {
    const response = await client.memories.$post({ json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to create memory"));
    return response.json();
  },

  updateMemory: async (
    memoryId: string,
    input: { kind?: AiMemoryKind; content?: string; priority?: AiMemoryPriority },
  ): Promise<AiMemory> => {
    const response = await client.memories[":memoryId"].$patch({ param: { memoryId }, json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to update memory"));
    return response.json();
  },

  deleteMemory: async (memoryId: string): Promise<void> => {
    const response = await client.memories[":memoryId"].$delete({ param: { memoryId } });
    if (!response.ok) throw new Error(await readError(response, "Failed to delete memory"));
  },

  setConversationPinned: async (conversationId: string, pinned: boolean): Promise<AiConversation> => {
    const endpoint = client.conversations[":conversationId"].pin;
    const response = pinned ? await endpoint.$post({ param: { conversationId } }) : await endpoint.$delete({ param: { conversationId } });
    if (!response.ok) throw new Error(await readError(response, pinned ? "Failed to pin chat" : "Failed to unpin chat"));
    return response.json();
  },

  archiveConversation: async (conversationId: string): Promise<void> => {
    const response = await client.conversations[":conversationId"].archive.$post({ param: { conversationId } });
    if (!response.ok) throw new Error(await readError(response, "Failed to archive chat"));
  },

  restoreConversation: async (conversationId: string): Promise<AiConversation> => {
    const response = await client.conversations[":conversationId"].restore.$post({ param: { conversationId } });
    if (!response.ok) throw new Error(await readError(response, "Failed to restore chat"));
    return response.json();
  },

  getEnrichment: async (conversationId: string): Promise<{ status: AiEnrichmentStatus | null; runs: AiEnrichmentRun[] }> => {
    const response = await client.conversations[":conversationId"].enrichment.$get({ param: { conversationId } });
    if (!response.ok) throw new Error(await readError(response, "Failed to load index status"));
    return response.json();
  },

  reindexConversation: async (conversationId: string): Promise<void> => {
    const response = await client.conversations[":conversationId"].reindex.$post({ param: { conversationId } });
    if (!response.ok) throw new Error(await readError(response, "Failed to queue reindex"));
  },
};
