import { sql } from "bun";
import { logger } from "../services/logging";
import { withAiShortId } from "./short-id";

export const AI_MEMORY_CONTENT_MAX_CHARS = 500;
export const AI_MEMORY_HOT_MAX_ITEMS = 20;
export const AI_MEMORY_HOT_MAX_CHARS = 6_000;

export type AiMemoryKind = "fact" | "preference";
export type AiMemoryPriority = "normal" | "pinned";
export type AiMemorySource = "user" | "agent" | "background";

export type AiMemory = {
  id: string;
  shortId: string;
  userId: string;
  kind: AiMemoryKind;
  content: string;
  priority: AiMemoryPriority;
  source: AiMemorySource;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MemoryRow = {
  id: string;
  short_id: string;
  user_id: string;
  kind: AiMemoryKind;
  content: string;
  priority: AiMemoryPriority;
  source: AiMemorySource;
  source_conversation_id: string | null;
  source_message_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type SearchBackend = "native" | "bm25";

const BM25_INDEX = "ai.memories_search_bm25_idx";
const BM25_CAPABILITY_ERROR_CODES = new Set(["0A000", "42704", "42883", "55000"]);
const log = logger("ai:memories");

let backendPromise: Promise<SearchBackend> | null = null;

const toMemory = (row: MemoryRow): AiMemory => ({
  id: row.id,
  shortId: row.short_id,
  userId: row.user_id,
  kind: row.kind,
  content: row.content,
  priority: row.priority,
  source: row.source,
  sourceConversationId: row.source_conversation_id,
  sourceMessageId: row.source_message_id,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const normalizeContent = (content: string): string => content.replace(/\s+/g, " ").trim().slice(0, AI_MEMORY_CONTENT_MAX_CHARS);

const detectSearchBackend = async (): Promise<SearchBackend> => {
  const [row] = await sql<{ available: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_textsearch')
      AND EXISTS (
        SELECT 1
        FROM pg_class index_class
        JOIN pg_am access_method ON access_method.oid = index_class.relam
        WHERE index_class.oid = to_regclass(${BM25_INDEX})
          AND access_method.amname = 'bm25'
      ) AS available
  `;
  const backend = row?.available ? "bm25" : "native";
  log.info("Memory search backend active", { backend });
  return backend;
};

export const getAiMemorySearchBackend = (): Promise<SearchBackend> => {
  backendPromise ??= detectSearchBackend().catch((error) => {
    log.warn("Memory search backend detection failed; using native PostgreSQL FTS", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "native";
  });
  return backendPromise;
};

/** Test and migration hook. Runtime callers should use getAiMemorySearchBackend(). */
export const resetAiMemorySearchBackend = (): void => {
  backendPromise = null;
};

export const isAiMemoryBm25CapabilityError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return BM25_CAPABILITY_ERROR_CODES.has(String(error.code));
};

const listActive = async (userId: string, limit: number): Promise<AiMemory[]> => {
  const rows = await sql<MemoryRow[]>`
    SELECT id, short_id, user_id, kind, content, priority, source, source_conversation_id, source_message_id, created_at, updated_at
    FROM ai.memories
    WHERE user_id = ${userId}::uuid AND deleted_at IS NULL AND superseded_by_id IS NULL
    ORDER BY (priority = 'pinned') DESC, updated_at DESC, id ASC
    LIMIT ${limit}
  `;
  return rows.map(toMemory);
};

const searchRows = async (input: { userId: string; query: string; limit: number; backend: SearchBackend }): Promise<AiMemory[]> => {
  const query = input.query.trim();
  if (!query) return listActive(input.userId, input.limit);

  const rows =
    input.backend === "bm25"
      ? await sql<MemoryRow[]>`
          SELECT id, short_id, user_id, kind, content, priority, source, source_conversation_id, source_message_id, created_at, updated_at
          FROM ai.memories
          WHERE user_id = ${input.userId}::uuid
            AND deleted_at IS NULL AND superseded_by_id IS NULL
            AND search_document @@ websearch_to_tsquery('simple', ${query})
          ORDER BY
            (priority = 'pinned') DESC,
            content <@> to_bm25query(${query}, ${BM25_INDEX}),
            updated_at DESC,
            id ASC
          LIMIT ${input.limit}
        `
      : await sql<MemoryRow[]>`
          SELECT id, short_id, user_id, kind, content, priority, source, source_conversation_id, source_message_id, created_at, updated_at
          FROM ai.memories
          WHERE user_id = ${input.userId}::uuid
            AND deleted_at IS NULL AND superseded_by_id IS NULL
            AND search_document @@ websearch_to_tsquery('simple', ${query})
          ORDER BY
            (priority = 'pinned') DESC,
            ts_rank_cd(search_document, websearch_to_tsquery('simple', ${query})) DESC,
            updated_at DESC,
            id ASC
          LIMIT ${input.limit}
        `;
  return rows.map(toMemory);
};

const search = async (input: { userId: string; query?: string; limit?: number }): Promise<AiMemory[]> => {
  const query = input.query?.trim() ?? "";
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const backend = query ? await getAiMemorySearchBackend() : "native";
  try {
    return await searchRows({ userId: input.userId, query, limit, backend });
  } catch (error) {
    if (backend !== "bm25" || !isAiMemoryBm25CapabilityError(error)) throw error;
    log.warn("Memory BM25 query failed; falling back to native PostgreSQL FTS", {
      error: error instanceof Error ? error.message : String(error),
    });
    backendPromise = Promise.resolve("native");
    return searchRows({ userId: input.userId, query, limit, backend: "native" });
  }
};

export const formatAiMemories = (
  memories: AiMemory[],
  maxChars = AI_MEMORY_HOT_MAX_CHARS,
): { text: string; included: AiMemory[]; truncated: boolean } => {
  const lines: string[] = [];
  const included: AiMemory[] = [];
  let used = 0;
  for (const memory of memories) {
    const date = memory.updatedAt.slice(0, 10);
    const line = `- [${date}] ${memory.kind}: ${memory.content}`;
    if (used + line.length + (lines.length > 0 ? 1 : 0) > maxChars) break;
    lines.push(line);
    included.push(memory);
    used += line.length + (lines.length > 1 ? 1 : 0);
  }
  return { text: lines.join("\n"), included, truncated: included.length < memories.length };
};

export const aiMemories = {
  list: search,

  async wasDeleted(userId: string, content: string): Promise<boolean> {
    const normalized = normalizeContent(content);
    if (!normalized) return false;
    const [row] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM ai.memories
        WHERE user_id = ${userId}::uuid AND lower(content) = lower(${normalized}) AND deleted_at IS NOT NULL
      ) AS exists
    `;
    return Boolean(row?.exists);
  },

  async get(userId: string, memoryId: string): Promise<AiMemory | null> {
    const rows = await sql<MemoryRow[]>`
      SELECT id, short_id, user_id, kind, content, priority, source, source_conversation_id, source_message_id, created_at, updated_at
      FROM ai.memories
      WHERE id = ${memoryId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL AND superseded_by_id IS NULL
    `;
    return rows[0] ? toMemory(rows[0]) : null;
  },

  async getByShortId(userId: string, shortId: string): Promise<AiMemory | null> {
    const rows = await sql<MemoryRow[]>`
      SELECT id, short_id, user_id, kind, content, priority, source, source_conversation_id, source_message_id, created_at, updated_at
      FROM ai.memories
      WHERE short_id = ${shortId} AND user_id = ${userId}::uuid AND deleted_at IS NULL AND superseded_by_id IS NULL
    `;
    return rows[0] ? toMemory(rows[0]) : null;
  },

  async create(input: {
    userId: string;
    kind: AiMemoryKind;
    content: string;
    priority?: AiMemoryPriority;
    source?: AiMemorySource;
    sourceConversationId?: string;
    sourceMessageId?: string;
  }): Promise<AiMemory> {
    const content = normalizeContent(input.content);
    if (!content) throw new Error("Memory content is required.");
    const rows = await withAiShortId(
      "idx_ai_memories_short_id",
      (shortId) => sql<MemoryRow[]>`
      INSERT INTO ai.memories (short_id, user_id, kind, content, priority, source, source_conversation_id, source_message_id)
      VALUES (
        ${shortId},
        ${input.userId}::uuid,
        ${input.kind},
        ${content},
        ${input.priority ?? "normal"},
        ${input.source ?? "user"},
        ${input.sourceConversationId ?? null}::uuid,
        ${input.sourceMessageId ?? null}::uuid
      )
      ON CONFLICT (user_id, lower(content)) WHERE deleted_at IS NULL AND superseded_by_id IS NULL
      DO UPDATE SET updated_at = ai.memories.updated_at
      RETURNING id, short_id, user_id, kind, content, priority, source, source_conversation_id, source_message_id, created_at, updated_at
    `,
    );
    return toMemory(rows[0]!);
  },

  async update(
    userId: string,
    memoryId: string,
    patch: {
      kind?: AiMemoryKind;
      content?: string;
      priority?: AiMemoryPriority;
      source?: AiMemorySource;
      sourceConversationId?: string;
    },
  ): Promise<AiMemory | null> {
    const content = patch.content === undefined ? null : normalizeContent(patch.content);
    if (patch.content !== undefined && !content) throw new Error("Memory content is required.");
    const rows = await sql<MemoryRow[]>`
      UPDATE ai.memories
      SET kind = COALESCE(${patch.kind ?? null}, kind),
          content = COALESCE(${content}, content),
          priority = COALESCE(${patch.priority ?? null}, priority),
          source = COALESCE(${patch.source ?? null}, source),
          source_conversation_id = COALESCE(${patch.sourceConversationId ?? null}::uuid, source_conversation_id),
          updated_at = now()
      WHERE id = ${memoryId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL AND superseded_by_id IS NULL
      RETURNING id, short_id, user_id, kind, content, priority, source, source_conversation_id, source_message_id, created_at, updated_at
    `;
    return rows[0] ? toMemory(rows[0]) : null;
  },

  async updateByShortId(
    userId: string,
    shortId: string,
    patch: {
      kind?: AiMemoryKind;
      content?: string;
      priority?: AiMemoryPriority;
      source?: AiMemorySource;
      sourceConversationId?: string;
    },
  ): Promise<AiMemory | null> {
    const memory = await this.getByShortId(userId, shortId);
    return memory ? this.update(userId, memory.id, patch) : null;
  },

  async delete(userId: string, memoryId: string): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.memories SET deleted_at = now(), updated_at = now()
      WHERE id = ${memoryId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL AND superseded_by_id IS NULL
      RETURNING id
    `;
    return Boolean(rows[0]);
  },

  async deleteByShortId(userId: string, shortId: string): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.memories SET deleted_at = now(), updated_at = now()
      WHERE short_id = ${shortId} AND user_id = ${userId}::uuid AND deleted_at IS NULL AND superseded_by_id IS NULL
      RETURNING id
    `;
    return Boolean(rows[0]);
  },

  async supersede(userId: string, memoryId: string, supersededById: string, sourceConversationId?: string): Promise<boolean> {
    if (memoryId === supersededById) return false;
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.memories old
      SET superseded_by_id = newer.id,
          source = 'background',
          source_conversation_id = COALESCE(${sourceConversationId ?? null}::uuid, old.source_conversation_id),
          updated_at = now()
      FROM ai.memories newer
      WHERE old.id = ${memoryId}::uuid
        AND old.user_id = ${userId}::uuid
        AND old.deleted_at IS NULL AND old.superseded_by_id IS NULL
        AND newer.id = ${supersededById}::uuid
        AND newer.user_id = old.user_id
        AND newer.deleted_at IS NULL AND newer.superseded_by_id IS NULL
      RETURNING old.id
    `;
    return Boolean(rows[0]);
  },

  async selectHot(userId: string, query: string): Promise<{ text: string; memories: AiMemory[]; truncated: boolean }> {
    const [countRow] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM ai.memories
      WHERE user_id = ${userId}::uuid AND deleted_at IS NULL AND superseded_by_id IS NULL
    `;
    const count = countRow?.count ?? 0;
    if (count <= AI_MEMORY_HOT_MAX_ITEMS) {
      const memories = await listActive(userId, AI_MEMORY_HOT_MAX_ITEMS);
      const formatted = formatAiMemories(memories);
      return { text: formatted.text, memories: formatted.included, truncated: formatted.truncated };
    }

    const [pinned, relevant, recent] = await Promise.all([
      listActive(userId, 50).then((items) => items.filter((item) => item.priority === "pinned")),
      search({ userId, query, limit: 40 }),
      listActive(userId, 40),
    ]);
    const seen = new Set<string>();
    const ranked = [...pinned, ...relevant, ...recent].filter((memory) => {
      if (seen.has(memory.id)) return false;
      seen.add(memory.id);
      return true;
    });
    const formatted = formatAiMemories(ranked.slice(0, AI_MEMORY_HOT_MAX_ITEMS));
    return { text: formatted.text, memories: formatted.included, truncated: count > formatted.included.length };
  },
};
