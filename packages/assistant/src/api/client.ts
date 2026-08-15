import type {
  AiConversation,
  AiConversationPage,
  AiConversationResourceOccurrence,
  AiConversationResourceRef,
  AiConversationSource,
  AiConversationStatusFilter,
  AiEnrichmentRun,
  AiEnrichmentStatus,
  AiFileStat,
  AiMemory,
  AiMemoryKind,
  AiMemoryPriority,
  AiStoredMessage,
  AiUserPrefs,
} from "@valentinkolb/cloud/ai";
import { api } from "@valentinkolb/cloud/browser";
import type { AssistantChatContextSnapshot } from "../chat-context";
import type { AssistantChatTask } from "../chat-tasks-contracts";
import type { AssistantProjectContextSnapshot } from "../project-context";
import type { AssistantSidebarSnapshot } from "../sidebar";
import type { ApiType } from ".";

const client = api.create<ApiType>({ baseUrl: "/api/assistant" });

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : fallback;
};

/** Typed conversation-management facade used by the Assistant UI. */
export const assistantApi = {
  loadSidebar: async (signal?: AbortSignal): Promise<AssistantSidebarSnapshot> => {
    const response = await client.workspace.sidebar.$get({}, { init: { signal } });
    if (!response.ok) throw new Error(await readError(response, "Failed to load Assistant navigation"));
    return (await response.json()) as AssistantSidebarSnapshot;
  },

  loadChatContext: async (conversationId: string, signal?: AbortSignal): Promise<AssistantChatContextSnapshot> => {
    const response = await client.workspace.conversations[":conversationId"].context.$get(
      { param: { conversationId } },
      { init: { signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to load chat context"));
    return (await response.json()) as AssistantChatContextSnapshot;
  },

  loadProjectContext: async (projectId: string, signal?: AbortSignal): Promise<AssistantProjectContextSnapshot> => {
    const response = await client.workspace.projects[":projectId"].context.$get({ param: { projectId } }, { init: { signal } });
    if (!response.ok) throw new Error(await readError(response, "Failed to load Project context"));
    return (await response.json()) as AssistantProjectContextSnapshot;
  },

  listConversations: async (input: {
    q?: string;
    limit?: number;
    archived?: boolean;
    status?: AiConversationStatusFilter;
    projectId?: string;
    unassigned?: boolean;
    signal?: AbortSignal;
  }): Promise<AiConversation[]> => {
    const response = await client.conversations.$get(
      {
        query: {
          q: input.q,
          limit: input.limit ? String(input.limit) : undefined,
          archived: input.archived ? "true" : undefined,
          status: input.status,
          projectId: input.projectId,
          unassigned: input.unassigned ? "true" : undefined,
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
    projectId?: string;
    unassigned?: boolean;
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
          projectId: input.projectId,
          unassigned: input.unassigned ? "true" : undefined,
        },
      },
      { init: { signal: input.signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to load chats"));
    return response.json();
  },

  searchMessages: async (input: {
    conversationId: string;
    q: string;
    before?: number;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<{ messages: AiStoredMessage[]; nextCursor?: string }> => {
    const response = await client.conversations[":conversationId"].messages.search.$get(
      {
        param: { conversationId: input.conversationId },
        query: {
          q: input.q,
          before: input.before ? String(input.before) : undefined,
          limit: input.limit ? String(input.limit) : undefined,
        },
      },
      { init: { signal: input.signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to search chat messages"));
    return response.json();
  },

  listConversationResources: async (input: {
    conversationId: string;
    q?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<{ resources: AiConversationResourceRef[]; nextCursor?: string }> => {
    const response = await client.conversations[":conversationId"].resources.$get(
      {
        param: { conversationId: input.conversationId },
        query: { q: input.q, cursor: input.cursor, limit: input.limit ? String(input.limit) : undefined },
      },
      { init: { signal: input.signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to load chat resources"));
    return response.json();
  },

  listConversationSources: async (input: {
    conversationId: string;
    q?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<{ sources: AiConversationSource[]; nextCursor?: string }> => {
    const response = await client.conversations[":conversationId"].sources.$get(
      {
        param: { conversationId: input.conversationId },
        query: { q: input.q, cursor: input.cursor, limit: input.limit ? String(input.limit) : undefined },
      },
      { init: { signal: input.signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to load chat sources"));
    return response.json();
  },

  listConversationFiles: async (input: { conversationId: string; signal?: AbortSignal }): Promise<AiFileStat[]> => {
    const response = await client.conversations[":conversationId"].files.$get(
      { param: { conversationId: input.conversationId }, query: {} },
      { init: { signal: input.signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to load chat files"));
    return (await response.json()).files;
  },

  listChatTasks: async (input: { chatId: string; limit?: number; signal?: AbortSignal }): Promise<AssistantChatTask[]> => {
    const response = await client.tasks.$get(
      { query: { chatId: input.chatId, limit: String(input.limit ?? 50) } },
      { init: { signal: input.signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to load scheduled tasks"));
    return response.json();
  },

  listResources: async (
    input: { q?: string; cursor?: string; limit?: number; signal?: AbortSignal } = {},
  ): Promise<{
    resources: AiConversationResourceOccurrence[];
    nextCursor?: string;
  }> => {
    const response = await client.resources.$get(
      { query: { q: input.q, cursor: input.cursor, limit: input.limit ? String(input.limit) : undefined } },
      { init: { signal: input.signal } },
    );
    if (!response.ok) throw new Error(await readError(response, "Failed to load Assistant resources"));
    return response.json();
  },

  createConversation: async (input: { title?: string; projectId?: string } = {}): Promise<AiConversation> => {
    const response = await client.conversations.$post({ json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to create chat"));
    return response.json();
  },

  updateConversation: async (
    conversationId: string,
    input: { title: string; description?: string; pinned?: boolean },
  ): Promise<AiConversation> => {
    const response = await client.conversations[":conversationId"].$patch({ param: { conversationId }, json: input });
    if (!response.ok) throw new Error(await readError(response, "Failed to save chat"));
    return response.json();
  },

  updateConversationProject: async (conversationId: string, projectId: string | null): Promise<AiConversation> => {
    const response = await client.conversations[":conversationId"].project.$put({
      param: { conversationId },
      json: { projectId },
    });
    if (!response.ok) throw new Error(await readError(response, "Failed to choose Project"));
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
