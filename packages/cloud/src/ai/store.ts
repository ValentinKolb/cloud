import type { Message, SessionStore, StoreEntry } from "@valentinkolb/nessi";
import type { Usage } from "@valentinkolb/nessi/ai";
import { sql } from "bun";
import type { AiConversation, AiConversationResource, AiConversationStore, AiStoredMessage, AiTurn, AiTurnStatus } from "./types";

type ConversationRow = {
  id: string;
  app_id: string;
  resource_kind: "direct" | "resource";
  resource_app_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  title: string;
  created_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  seq: number;
  kind: "message" | "summary";
  message: unknown;
  model_profile_id: string | null;
  provider_model: string | null;
  usage: unknown;
  stop_reason: string | null;
  created_at: Date | string;
};

type TurnRow = {
  id: string;
  conversation_id: string;
  status: AiTurnStatus;
  model_profile_id: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  error: string | null;
};

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

const parseJsonValue = <T>(value: unknown): T => {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
};

const rowToConversation = (row: ConversationRow): AiConversation => ({
  id: row.id,
  appId: row.app_id,
  title: row.title,
  resource:
    row.resource_kind === "resource"
      ? {
          kind: "resource",
          appId: row.resource_app_id ?? row.app_id,
          resourceType: row.resource_type ?? "",
          resourceId: row.resource_id ?? "",
          title: row.title,
        }
      : { kind: "direct" },
  createdByUserId: row.created_by_user_id,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const rowToMessage = (row: MessageRow): AiStoredMessage => {
  const message = parseJsonValue<Message>(row.message);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    seq: row.seq,
    kind: row.kind,
    message,
    modelProfileId: row.model_profile_id,
    providerModel: row.provider_model,
    usage: row.usage ? parseJsonValue<Usage>(row.usage) : null,
    stopReason: row.stop_reason,
    createdAt: iso(row.created_at),
  };
};

const rowToTurn = (row: TurnRow): AiTurn => ({
  id: row.id,
  conversationId: row.conversation_id,
  status: row.status,
  modelProfileId: row.model_profile_id,
  createdAt: iso(row.created_at),
  completedAt: row.completed_at ? iso(row.completed_at) : null,
  error: row.error,
});

const resourceColumns = (resource: AiConversationResource | undefined, fallbackAppId: string) => {
  if (!resource || resource.kind === "direct") {
    return {
      resourceKind: "direct",
      resourceAppId: null,
      resourceType: null,
      resourceId: null,
    };
  }
  return {
    resourceKind: "resource",
    resourceAppId: resource.appId || fallbackAppId,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
  };
};

const resourceFilter = (resource: AiConversationResource | undefined, fallbackAppId: string) => {
  if (!resource) return null;
  const columns = resourceColumns(resource, fallbackAppId);
  return {
    kind: columns.resourceKind,
    appId: columns.resourceAppId,
    type: columns.resourceType,
    id: columns.resourceId,
  };
};

const firstText = (message: Message): string => {
  if (message.role !== "user") return "";
  const part = message.content.find(
    (entry): entry is string | { type: "text"; text: string } => typeof entry === "string" || entry.type === "text",
  );
  if (!part) return "";
  const text = typeof part === "string" ? part : part.text;
  return text.trim().replace(/\s+/g, " ").slice(0, 80);
};

const appendMessage = async (input: {
  conversationId: string;
  message: Message;
  kind?: "message" | "summary";
  seq?: number;
  modelProfileId?: string | null;
}): Promise<void> => {
  const usage = input.message.role === "assistant" ? (input.message.usage ?? null) : null;
  const providerModel = input.message.role === "assistant" ? (input.message.model ?? null) : null;
  const stopReason = input.message.role === "assistant" ? (input.message.stopReason ?? null) : null;

  await sql.begin(async () => {
    await sql`SELECT id FROM ai.conversations WHERE id = ${input.conversationId} FOR UPDATE`;
    const seqRows = input.seq
      ? [{ seq: input.seq }]
      : await sql<
          { seq: number }[]
        >`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM ai.messages WHERE conversation_id = ${input.conversationId}`;
    const seq = seqRows[0]?.seq ?? 1;

    await sql`
      INSERT INTO ai.messages (
        conversation_id,
        seq,
        kind,
        role,
        message,
        model_profile_id,
        provider_model,
        usage,
        stop_reason
      )
      VALUES (
        ${input.conversationId},
        ${seq},
        ${input.kind ?? "message"},
        ${input.message.role},
        ${JSON.stringify(input.message)}::jsonb,
        ${input.modelProfileId ?? null},
        ${providerModel},
        ${usage ? JSON.stringify(usage) : null}::jsonb,
        ${stopReason}
      )
    `;

    const title = firstText(input.message);
    if (seq === 1 && title) {
      await sql`
        UPDATE ai.conversations
        SET title = ${title}, updated_at = now()
        WHERE id = ${input.conversationId}
      `;
    } else {
      await sql`UPDATE ai.conversations SET updated_at = now() WHERE id = ${input.conversationId}`;
    }
  });
};

export const aiConversationStore: AiConversationStore = {
  createConversation: async (input) => {
    const resource = resourceColumns(input.resource, input.appId);
    const rows = await sql<ConversationRow[]>`
      INSERT INTO ai.conversations (
        app_id,
        resource_kind,
        resource_app_id,
        resource_type,
        resource_id,
        title,
        created_by_user_id
      )
      VALUES (
        ${input.appId},
        ${resource.resourceKind},
        ${resource.resourceAppId},
        ${resource.resourceType},
        ${resource.resourceId},
        ${input.title?.trim() || "New chat"},
        ${input.ownerUserId}
      )
      RETURNING *
    `;
    return rowToConversation(rows[0]!);
  },

  listConversations: async (input) => {
    const resource = resourceFilter(input.resource, input.appId);
    const rows = await sql<ConversationRow[]>`
      SELECT *
      FROM ai.conversations
      WHERE app_id = ${input.appId}
        AND created_by_user_id = ${input.ownerUserId}
        AND archived_at IS NULL
        AND (${resource?.kind ?? null}::text IS NULL OR resource_kind = ${resource?.kind ?? null})
        AND (${resource?.appId ?? null}::text IS NULL OR resource_app_id = ${resource?.appId ?? null})
        AND (${resource?.type ?? null}::text IS NULL OR resource_type = ${resource?.type ?? null})
        AND (${resource?.id ?? null}::text IS NULL OR resource_id = ${resource?.id ?? null})
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 100
    `;
    return rows.map(rowToConversation);
  },

  getConversation: async (input) => {
    const resource = input.appId ? resourceFilter(input.resource, input.appId) : null;
    const rows = await sql<ConversationRow[]>`
      SELECT *
      FROM ai.conversations
      WHERE id = ${input.conversationId}
        AND (${input.appId ?? null}::text IS NULL OR app_id = ${input.appId ?? null})
        AND (${input.ownerUserId ?? null}::uuid IS NULL OR created_by_user_id = ${input.ownerUserId ?? null})
        AND (${resource?.kind ?? null}::text IS NULL OR resource_kind = ${resource?.kind ?? null})
        AND (${resource?.appId ?? null}::text IS NULL OR resource_app_id = ${resource?.appId ?? null})
        AND (${resource?.type ?? null}::text IS NULL OR resource_type = ${resource?.type ?? null})
        AND (${resource?.id ?? null}::text IS NULL OR resource_id = ${resource?.id ?? null})
        AND archived_at IS NULL
      LIMIT 1
    `;
    return rows[0] ? rowToConversation(rows[0]) : null;
  },

  listMessages: async (input) => {
    const rows = await sql<MessageRow[]>`
      SELECT *
      FROM ai.messages
      WHERE conversation_id = ${input.conversationId}
      ORDER BY seq ASC
    `;
    return rows.map(rowToMessage);
  },

  createTurn: async (input) => {
    const rows = await sql<TurnRow[]>`
      INSERT INTO ai.turns (conversation_id, model_profile_id)
      VALUES (${input.conversationId}, ${input.modelProfileId})
      RETURNING *
    `;
    return rowToTurn(rows[0]!);
  },

  getRunningTurn: async (input) => {
    const rows = await sql<TurnRow[]>`
      SELECT *
      FROM ai.turns
      WHERE conversation_id = ${input.conversationId}
        AND status = 'running'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0] ? rowToTurn(rows[0]) : null;
  },

  completeTurn: async (input) => {
    await sql`
      UPDATE ai.turns
      SET status = ${input.status}, completed_at = now(), error = ${input.error ?? null}
      WHERE id = ${input.turnId}
    `;
  },

  createSessionStore: (input): SessionStore => ({
    load: async (): Promise<StoreEntry[]> => {
      const rows = await aiConversationStore.listMessages({ conversationId: input.conversationId });
      return rows.map((row) => ({ seq: row.seq, kind: row.kind, message: row.message }));
    },
    append: async (message, opts) => {
      await appendMessage({
        conversationId: input.conversationId,
        message,
        kind: opts?.kind,
        seq: opts?.seq,
        modelProfileId: input.modelProfileId,
      });
    },
  }),
};
