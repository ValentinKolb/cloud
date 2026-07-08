import type { DoneReason, InboundEvent, LoopAggregate, Message, SessionStore, StoreEntry } from "@valentinkolb/nessi";
import type { Usage } from "@valentinkolb/nessi/ai";
import { sql } from "bun";
import type { AiTurnBlock } from "./protocol";
import type {
  AiConversation,
  AiConversationPage,
  AiConversationResource,
  AiConversationStore,
  AiFrontendToolMode,
  AiPendingTurnAction,
  AiPendingTurnActionRecord,
  AiStoredMessage,
  AiTurn,
  AiTurnClaim,
  AiTurnRunConfig,
  AiTurnStatus,
  AiTurnSweepResult,
} from "./types";

/** A queued turn this old without a claim is considered lost and re-enqueued by the sweep. */
const SWEEP_STALE_QUEUED_MS = 15_000;
/** A queued turn this old that never started is failed outright. */
const SWEEP_DEAD_QUEUED_MS = 30 * 60_000;

type ConversationRow = {
  id: string;
  app_id: string;
  resource_kind: "direct" | "resource";
  resource_app_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  title: string;
  icon: string | null;
  description: string | null;
  created_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type CountRow = {
  total: number | string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  seq: number;
  kind: "message" | "summary";
  message: unknown;
  loop_id: string | null;
  model_profile_id: string | null;
  provider_model: string | null;
  usage: unknown;
  stop_reason: string | null;
  loop_aggregate: unknown;
  loop_done_reason: DoneReason | null;
  created_at: Date | string;
};

type TurnRow = {
  id: string;
  conversation_id: string;
  status: AiTurnStatus;
  attempt: number;
  model_profile_id: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  error: string | null;
  run_config?: unknown;
  live_blocks?: unknown;
  live_seq?: number | string;
  lease_owner?: string | null;
  lease_expires_at?: Date | string | null;
};

type PendingActionRow = {
  turn_id: string;
  conversation_id: string;
  call_id: string;
  kind: "approval" | "custom_approval" | "client_tool";
  status: "pending" | "resolved" | "aborted";
  tool_name: string;
  args: unknown;
  message: string | null;
  approval_scope: string;
  allow_always: boolean;
  frontend_mode: AiFrontendToolMode | null;
  resolved_event: unknown | null;
};

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

const sanitizePagination = (input: { page: number; perPage: number }) => {
  const page = Number.isInteger(input.page) && input.page > 0 ? input.page : 1;
  const perPage = Number.isInteger(input.perPage) && input.perPage > 0 ? Math.min(input.perPage, 100) : 20;
  return { page, perPage, offset: (page - 1) * perPage };
};

const searchPattern = (value: string | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? `%${trimmed}%` : null;
};

const parseJsonValue = <T>(value: unknown): T => {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
};

const rowToConversation = (row: ConversationRow): AiConversation => ({
  id: row.id,
  appId: row.app_id,
  title: row.title,
  icon: row.icon?.trim() || "ti ti-message",
  description: row.description ?? "",
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
    loopId: row.loop_id,
    modelProfileId: row.model_profile_id,
    providerModel: row.provider_model,
    usage: row.usage ? parseJsonValue<Usage>(row.usage) : null,
    stopReason: row.stop_reason,
    loopAggregate: row.loop_aggregate ? parseJsonValue<LoopAggregate>(row.loop_aggregate) : null,
    loopDoneReason: row.loop_done_reason,
    createdAt: iso(row.created_at),
  };
};

const rowToTurn = (row: TurnRow): AiTurn => ({
  id: row.id,
  conversationId: row.conversation_id,
  status: row.status,
  attempt: Number(row.attempt ?? 0),
  modelProfileId: row.model_profile_id,
  createdAt: iso(row.created_at),
  completedAt: row.completed_at ? iso(row.completed_at) : null,
  error: row.error,
});

const rowToLiveBlocks = (row: TurnRow): AiTurnBlock[] => {
  if (!row.live_blocks) return [];
  const parsed = parseJsonValue<AiTurnBlock[]>(row.live_blocks);
  return Array.isArray(parsed) ? parsed : [];
};

const pendingActionToPublicEvent = (row: PendingActionRow): AiPendingTurnAction =>
  row.kind === "client_tool"
    ? {
        type: "frontend_tool",
        turnId: row.turn_id,
        conversationId: row.conversation_id,
        callId: row.call_id,
        name: row.tool_name,
        args: parseJsonValue(row.args),
        mode: row.frontend_mode ?? "client",
      }
    : {
        type: "approval_request",
        turnId: row.turn_id,
        conversationId: row.conversation_id,
        callId: row.call_id,
        name: row.tool_name,
        args: parseJsonValue(row.args),
        message: row.message ?? undefined,
        allowAlways: row.allow_always,
      };

const rowToPendingActionRecord = (row: PendingActionRow): AiPendingTurnActionRecord => ({
  turnId: row.turn_id,
  conversationId: row.conversation_id,
  callId: row.call_id,
  kind: row.kind,
  status: row.status,
  name: row.tool_name,
  args: parseJsonValue(row.args),
  message: row.message ?? undefined,
  approvalScope: row.approval_scope,
  allowAlways: row.allow_always,
  frontendMode: row.frontend_mode ?? undefined,
  resolvedEvent: row.resolved_event ? parseJsonValue<InboundEvent>(row.resolved_event) : null,
});

const boundedMs = (value: number, fallback: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
};

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

const messageColumns = (message: Message) => ({
  usage: message.role === "assistant" ? (message.usage ?? null) : null,
  providerModel: message.role === "assistant" ? (message.model ?? null) : null,
  stopReason: message.role === "assistant" ? (message.stopReason ?? null) : null,
});

/** Insert a message inside an open conversation-lock transaction and bump the conversation. */
const insertMessageLocked = async (input: {
  conversationId: string;
  message: Message;
  kind?: "message" | "summary";
  seq?: number;
  loopId?: string | null;
  modelProfileId?: string | null;
}): Promise<MessageRow> => {
  const { usage, providerModel, stopReason } = messageColumns(input.message);
  const seqRows = input.seq
    ? [{ seq: input.seq }]
    : await sql<
        { seq: number }[]
      >`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM ai.messages WHERE conversation_id = ${input.conversationId} AND seq > 0`;
  const seq = seqRows[0]?.seq ?? 1;

  const rows = await sql<MessageRow[]>`
    INSERT INTO ai.messages (
      conversation_id,
      seq,
      kind,
      role,
      message,
      loop_id,
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
      ${input.loopId ?? null},
      ${input.modelProfileId ?? null},
      ${providerModel},
      ${usage ? JSON.stringify(usage) : null}::jsonb,
      ${stopReason}
    )
    RETURNING *
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
  return rows[0]!;
};

/** Append a turn-owned (assistant/tool_result/summary) message, guarded by lease ownership in one statement. */
const appendTurnOwnedMessage = async (input: {
  conversationId: string;
  turnId: string;
  leaseOwner: string;
  message: Message;
  kind?: "message" | "summary";
  seq?: number;
  loopId: string | null;
  modelProfileId?: string | null;
}): Promise<boolean> => {
  const { usage, providerModel, stopReason } = messageColumns(input.message);
  const rows = await sql<{ id: string }[]>`
    INSERT INTO ai.messages (
      conversation_id,
      seq,
      kind,
      role,
      message,
      loop_id,
      model_profile_id,
      provider_model,
      usage,
      stop_reason
    )
    SELECT
      ${input.conversationId},
      CASE
        WHEN ${input.seq ?? null}::int IS NOT NULL AND ${input.seq ?? null}::int > 0 THEN ${input.seq ?? null}::int
        ELSE (SELECT COALESCE(MAX(seq), 0) + 1 FROM ai.messages WHERE conversation_id = ${input.conversationId} AND seq > 0)
      END,
      ${input.kind ?? "message"},
      ${input.message.role},
      ${JSON.stringify(input.message)}::jsonb,
      ${input.loopId},
      ${input.modelProfileId ?? null},
      ${providerModel},
      ${usage ? JSON.stringify(usage) : null}::jsonb,
      ${stopReason}
    WHERE EXISTS (
      SELECT 1
      FROM ai.turns
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
        AND status IN ('running', 'waiting_for_action')
        AND lease_owner = ${input.leaseOwner}
    )
    RETURNING id
  `;
  if (rows[0]) {
    await sql`UPDATE ai.conversations SET updated_at = now() WHERE id = ${input.conversationId}`;
    return true;
  }
  return false;
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
        icon,
        description,
        created_by_user_id
      )
      VALUES (
        ${input.appId},
        ${resource.resourceKind},
        ${resource.resourceAppId},
        ${resource.resourceType},
        ${resource.resourceId},
        ${input.title?.trim() || "New chat"},
        ${input.icon?.trim() || "ti ti-message"},
        ${input.description?.trim() ?? ""},
        ${input.ownerUserId}
      )
      RETURNING *
    `;
    return rowToConversation(rows[0]!);
  },

  listConversations: async (input) => {
    const resource = resourceFilter(input.resource, input.appId);
    const pattern = searchPattern(input.search);
    const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 500) : 100;
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
        AND (${pattern}::text IS NULL OR LOWER(title) LIKE ${pattern} OR LOWER(description) LIKE ${pattern})
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(rowToConversation);
  },

  listConversationsPage: async (input): Promise<AiConversationPage> => {
    const resource = resourceFilter(input.resource, input.appId);
    const pattern = searchPattern(input.search);
    const { page, perPage, offset } = sanitizePagination(input);
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
        AND (${pattern}::text IS NULL OR LOWER(title) LIKE ${pattern} OR LOWER(description) LIKE ${pattern})
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ${perPage}
      OFFSET ${offset}
    `;
    const countRows = await sql<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM ai.conversations
      WHERE app_id = ${input.appId}
        AND created_by_user_id = ${input.ownerUserId}
        AND archived_at IS NULL
        AND (${resource?.kind ?? null}::text IS NULL OR resource_kind = ${resource?.kind ?? null})
        AND (${resource?.appId ?? null}::text IS NULL OR resource_app_id = ${resource?.appId ?? null})
        AND (${resource?.type ?? null}::text IS NULL OR resource_type = ${resource?.type ?? null})
        AND (${resource?.id ?? null}::text IS NULL OR resource_id = ${resource?.id ?? null})
        AND (${pattern}::text IS NULL OR LOWER(title) LIKE ${pattern} OR LOWER(description) LIKE ${pattern})
    `;
    const total = Number(countRows[0]?.total ?? 0);
    return {
      items: rows.map(rowToConversation),
      total,
      page,
      perPage,
      hasNext: page * perPage < total,
    };
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

  updateConversationMetadata: async (input) => {
    const title = input.title.trim() || "New chat";
    const icon = input.icon?.trim() || "ti ti-message";
    const description = input.description?.trim() ?? "";
    const rows = await sql<ConversationRow[]>`
      UPDATE ai.conversations
      SET title = ${title},
          icon = ${icon},
          description = ${description},
          updated_at = now()
      WHERE id = ${input.conversationId}
        AND (${input.appId ?? null}::text IS NULL OR app_id = ${input.appId ?? null})
        AND (${input.ownerUserId ?? null}::uuid IS NULL OR created_by_user_id = ${input.ownerUserId ?? null})
        AND archived_at IS NULL
      RETURNING *
    `;
    return rows[0] ? rowToConversation(rows[0]) : null;
  },

  archiveConversation: async (input) => {
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.conversations
      SET archived_at = now(), updated_at = now()
      WHERE id = ${input.conversationId}
        AND (${input.appId ?? null}::text IS NULL OR app_id = ${input.appId ?? null})
        AND (${input.ownerUserId ?? null}::uuid IS NULL OR created_by_user_id = ${input.ownerUserId ?? null})
        AND archived_at IS NULL
      RETURNING id
    `;
    return Boolean(rows[0]);
  },

  listMessages: async (input) => {
    const rows = await sql<MessageRow[]>`
      SELECT *
      FROM ai.messages
      WHERE conversation_id = ${input.conversationId}
        AND compacted_at IS NULL
      ORDER BY seq ASC
    `;
    return rows.map(rowToMessage);
  },

  listTurnMessages: async (input) => {
    const rows = await sql<MessageRow[]>`
      SELECT *
      FROM ai.messages
      WHERE conversation_id = ${input.conversationId}
        AND loop_id = ${input.loopId}
        AND compacted_at IS NULL
      ORDER BY seq ASC
    `;
    return rows.map(rowToMessage);
  },

  copyMessages: async (input) => {
    const throughSeq = Math.floor(input.throughSeq);
    if (!Number.isFinite(throughSeq) || throughSeq <= 0) return;

    await sql.begin(async () => {
      await sql`SELECT id FROM ai.conversations WHERE id = ${input.targetConversationId} FOR UPDATE`;
      await sql`
        INSERT INTO ai.messages (
          conversation_id,
          seq,
          kind,
          role,
          message,
          loop_id,
          model_profile_id,
          provider_model,
          usage,
          stop_reason,
          loop_aggregate,
          loop_done_reason
        )
        SELECT
          ${input.targetConversationId},
          seq,
          kind,
          role,
          message,
          loop_id,
          model_profile_id,
          provider_model,
          usage,
          stop_reason,
          loop_aggregate,
          loop_done_reason
        FROM ai.messages
        WHERE conversation_id = ${input.sourceConversationId}
          AND compacted_at IS NULL
          AND seq <= ${throughSeq}
        ORDER BY seq ASC
      `;
      await sql`UPDATE ai.conversations SET updated_at = now() WHERE id = ${input.targetConversationId}`;
    });
  },

  truncateMessagesFrom: async (input) => {
    const fromSeq = Math.floor(input.fromSeq);
    if (!Number.isFinite(fromSeq) || fromSeq <= 0) return;

    await sql.begin(async () => {
      await sql`SELECT id FROM ai.conversations WHERE id = ${input.conversationId} FOR UPDATE`;
      await sql`
        DELETE FROM ai.messages
        WHERE conversation_id = ${input.conversationId}
          AND compacted_at IS NULL
          AND seq >= ${fromSeq}
      `;
      await sql`UPDATE ai.conversations SET updated_at = now() WHERE id = ${input.conversationId}`;
    });
  },

  setLatestAssistantLoopAggregate: async (input) => {
    const loopId = input.loopId ?? null;
    await sql`
      UPDATE ai.messages
      SET loop_aggregate = ${JSON.stringify(input.aggregate)}::jsonb,
          loop_done_reason = ${input.doneReason},
          usage = COALESCE(${input.aggregate.usage ? JSON.stringify(input.aggregate.usage) : null}::jsonb, usage)
      WHERE id = (
        SELECT id
        FROM ai.messages
        WHERE conversation_id = ${input.conversationId}
          AND compacted_at IS NULL
          AND kind = 'message'
          AND role = 'assistant'
          AND (${loopId}::text IS NULL OR loop_id = ${loopId})
        ORDER BY seq DESC
        LIMIT 1
      )
    `;
  },

  compactMessages: async (input) => {
    const checkpointSeq = Math.floor(input.checkpointSeq);
    if (!Number.isFinite(checkpointSeq) || checkpointSeq <= 0) return;

    await sql.begin(async () => {
      await sql`SELECT id FROM ai.conversations WHERE id = ${input.conversationId} FOR UPDATE`;
      const rows = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM ai.messages
        WHERE conversation_id = ${input.conversationId}
          AND compacted_at IS NULL
          AND seq <= ${checkpointSeq}
      `;
      if ((rows[0]?.count ?? 0) === 0) return;

      await sql`
        UPDATE ai.messages
        SET compacted_at = now()
        WHERE conversation_id = ${input.conversationId}
          AND compacted_at IS NULL
          AND seq <= ${checkpointSeq}
      `;

      await insertMessageLocked({
        conversationId: input.conversationId,
        message: input.summary,
        kind: "summary",
        seq: checkpointSeq,
        loopId: null,
        modelProfileId: input.modelProfileId ?? null,
      });
    });
  },

  createTurn: async (input) => {
    const rows = await sql<TurnRow[]>`
      INSERT INTO ai.turns (
        conversation_id,
        model_profile_id,
        status,
        run_config
      )
      VALUES (
        ${input.conversationId},
        ${input.modelProfileId},
        'queued',
        ${input.runConfig ? JSON.stringify(input.runConfig) : null}::jsonb
      )
      RETURNING *
    `;
    return rowToTurn(rows[0]!);
  },

  submitChatTurn: async (input) => {
    return await sql.begin(async () => {
      await sql`SELECT id FROM ai.conversations WHERE id = ${input.conversationId} FOR UPDATE`;
      if (typeof input.truncateFromSeq === "number" && input.truncateFromSeq > 0) {
        await sql`
          DELETE FROM ai.messages
          WHERE conversation_id = ${input.conversationId}
            AND compacted_at IS NULL
            AND seq >= ${Math.floor(input.truncateFromSeq)}
        `;
      }
      const turnRows = await sql<TurnRow[]>`
        INSERT INTO ai.turns (
          conversation_id,
          model_profile_id,
          status,
          run_config
        )
        VALUES (
          ${input.conversationId},
          ${input.modelProfileId},
          'queued',
          ${JSON.stringify(input.runConfig)}::jsonb
        )
        RETURNING *
      `;
      const turn = rowToTurn(turnRows[0]!);
      const messageRow = await insertMessageLocked({
        conversationId: input.conversationId,
        message: input.userMessage,
        loopId: turn.id,
      });
      return { turn, message: rowToMessage(messageRow) };
    });
  },

  getTurn: async (input) => {
    const rows = await sql<TurnRow[]>`
      SELECT *
      FROM ai.turns
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
      LIMIT 1
    `;
    return rows[0] ? rowToTurn(rows[0]) : null;
  },

  getActiveTurn: async (input) => {
    const rows = await sql<TurnRow[]>`
      SELECT *
      FROM ai.turns
      WHERE conversation_id = ${input.conversationId}
        AND status IN ('queued', 'running', 'waiting_for_action')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!rows[0]) return null;
    return {
      turn: rowToTurn(rows[0]),
      liveBlocks: rowToLiveBlocks(rows[0]),
      liveSeq: Number(rows[0].live_seq ?? 0),
    };
  },

  claimTurn: async (input) => {
    const leaseMs = boundedMs(input.leaseMs, 60_000, 5_000, 5 * 60_000);
    const runBudgetMs = boundedMs(input.runBudgetMs, 10 * 60_000, 10_000, 60 * 60_000);
    const maxAttempts = Math.max(1, Math.floor(input.maxAttempts));
    const rows = await sql<TurnRow[]>`
      UPDATE ai.turns
      SET attempt = attempt + 1,
          status = 'running',
          lease_owner = ${input.leaseOwner},
          lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
          heartbeat_at = now(),
          deadline = CASE
            WHEN ${input.from} = 'waiting' THEN now() + (${runBudgetMs} * interval '1 millisecond')
            ELSE COALESCE(deadline, now() + (${runBudgetMs} * interval '1 millisecond'))
          END
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
        AND cancel_requested_at IS NULL
        AND attempt < ${maxAttempts}
        AND (
          (
            ${input.from} = 'queue'
            AND (
              status = 'queued'
              OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < now()))
            )
          )
          OR (
            ${input.from} = 'waiting'
            AND status = 'waiting_for_action'
            AND EXISTS (
              SELECT 1
              FROM ai.pending_actions
              WHERE turn_id = ${input.turnId}
                AND conversation_id = ${input.conversationId}
                AND status = 'resolved'
            )
          )
        )
      RETURNING *
    `;
    if (!rows[0]) return null;
    const claim: AiTurnClaim = {
      turn: rowToTurn(rows[0]),
      runConfig: rows[0].run_config ? parseJsonValue<AiTurnRunConfig>(rows[0].run_config) : null,
      liveBlocks: rows[0].live_blocks ? rowToLiveBlocks(rows[0]) : null,
      liveSeq: Number(rows[0].live_seq ?? 0),
    };
    return claim;
  },

  heartbeatTurn: async (input) => {
    const leaseMs = boundedMs(input.leaseMs, 60_000, 5_000, 5 * 60_000);
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.turns
      SET heartbeat_at = now(),
          lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
        AND lease_owner = ${input.leaseOwner}
        AND status = 'running'
        AND cancel_requested_at IS NULL
      RETURNING id
    `;
    return Boolean(rows[0]);
  },

  suspendTurn: async (input) => {
    const waitingBudgetMs = boundedMs(input.waitingBudgetMs, 24 * 60 * 60_000, 60_000, 7 * 24 * 60 * 60_000);
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.turns
      SET status = 'waiting_for_action',
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = now(),
          live_blocks = ${JSON.stringify(input.blocks)}::jsonb,
          live_seq = ${input.seq},
          deadline = now() + (${waitingBudgetMs} * interval '1 millisecond')
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
        AND status = 'running'
        AND lease_owner = ${input.leaseOwner}
      RETURNING id
    `;
    return Boolean(rows[0]);
  },

  saveTurnLiveState: async (input) => {
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.turns
      SET live_blocks = ${JSON.stringify(input.blocks)}::jsonb,
          live_seq = ${input.seq}
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
        AND status = 'running'
        AND lease_owner = ${input.leaseOwner}
      RETURNING id
    `;
    return Boolean(rows[0]);
  },

  requestTurnAbort: async (input) => {
    const reason = input.reason ?? "user";
    const rows = await sql<TurnRow[]>`
      UPDATE ai.turns
      SET cancel_requested_at = COALESCE(cancel_requested_at, now()),
          cancellation_reason = COALESCE(cancellation_reason, ${reason})
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
        AND status IN ('queued', 'running', 'waiting_for_action')
      RETURNING status, lease_owner, lease_expires_at, id, conversation_id, attempt, model_profile_id, created_at, completed_at, error
    `;
    if (!rows[0]) return { found: false };
    const row = rows[0];
    const ownerless = !row.lease_owner || !row.lease_expires_at || new Date(row.lease_expires_at).getTime() < Date.now();
    return { found: true, status: row.status, ownerless };
  },

  completeTurn: async (input) => {
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.turns
      SET status = ${input.status},
          completed_at = now(),
          error = ${input.error ?? null},
          lease_owner = NULL,
          lease_expires_at = NULL,
          live_blocks = NULL
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
        AND status IN ('queued', 'running', 'waiting_for_action')
        AND (
          (${input.leaseOwner ?? null}::text IS NOT NULL AND lease_owner = ${input.leaseOwner ?? null})
          OR (
            ${input.leaseOwner ?? null}::text IS NULL
            AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < now())
          )
        )
      RETURNING id
    `;
    if (rows[0]) {
      await sql`
        UPDATE ai.pending_actions
        SET status = 'aborted', resolved_at = COALESCE(resolved_at, now())
        WHERE turn_id = ${input.turnId}
          AND status = 'pending'
      `;
      return true;
    }
    return false;
  },

  sweepTurns: async (input) => {
    const limit = Math.min(Math.max(Math.floor(input?.limit ?? 200), 1), 1_000);
    const result: AiTurnSweepResult = { requeued: [], failed: [], aborted: [] };

    // 1) Finalize over-budget turns without a live lease.
    const failedRows = await sql<{ id: string; conversation_id: string; error: string; attempt: number; live_seq: number | string }[]>`
      UPDATE ai.turns
      SET status = 'failed',
          completed_at = now(),
          error = 'AI turn exceeded its execution budget.',
          lease_owner = NULL,
          lease_expires_at = NULL,
          live_blocks = NULL
      WHERE id IN (
        SELECT id FROM ai.turns
        WHERE status IN ('queued', 'running')
          AND (
            (deadline IS NOT NULL AND deadline < now())
            OR (status = 'queued' AND deadline IS NULL AND created_at < now() - (${SWEEP_DEAD_QUEUED_MS} * interval '1 millisecond'))
          )
          AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < now())
        LIMIT ${limit}
      )
      RETURNING id, conversation_id, error, attempt, live_seq
    `;
    result.failed = failedRows.map((row) => ({
      conversationId: row.conversation_id,
      turnId: row.id,
      error: row.error,
      attempt: Number(row.attempt),
      seq: Number(row.live_seq) + 1,
    }));

    // 2) Finalize aborts: cancel-requested turns without a live lease, and expired waits.
    const abortedRows = await sql<{ id: string; conversation_id: string; attempt: number; live_seq: number | string }[]>`
      UPDATE ai.turns
      SET status = 'aborted',
          completed_at = now(),
          cancellation_reason = COALESCE(cancellation_reason, 'sweep'),
          lease_owner = NULL,
          lease_expires_at = NULL,
          live_blocks = NULL
      WHERE id IN (
        SELECT id FROM ai.turns
        WHERE status IN ('queued', 'running', 'waiting_for_action')
          AND (
            (cancel_requested_at IS NOT NULL AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < now()))
            OR (status = 'waiting_for_action' AND deadline IS NOT NULL AND deadline < now())
          )
        LIMIT ${limit}
      )
      RETURNING id, conversation_id, attempt, live_seq
    `;
    result.aborted = abortedRows.map((row) => ({
      conversationId: row.conversation_id,
      turnId: row.id,
      attempt: Number(row.attempt),
      seq: Number(row.live_seq) + 1,
    }));

    for (const finalized of [...result.failed, ...result.aborted]) {
      await sql`
        UPDATE ai.pending_actions
        SET status = 'aborted', resolved_at = COALESCE(resolved_at, now())
        WHERE turn_id = ${finalized.turnId}
          AND status = 'pending'
      `;
    }

    // 3) Requeue crashed running turns (lease expired, still within budget).
    const requeuedRows = await sql<{ id: string; conversation_id: string }[]>`
      UPDATE ai.turns
      SET status = 'queued',
          lease_owner = NULL,
          lease_expires_at = NULL
      WHERE id IN (
        SELECT id FROM ai.turns
        WHERE status = 'running'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < now()
          AND cancel_requested_at IS NULL
          AND (deadline IS NULL OR deadline > now())
        LIMIT ${limit}
      )
      RETURNING id, conversation_id
    `;

    // 4) Stale queued turns whose queue message may be lost — re-enqueue them too.
    const staleQueuedRows = await sql<{ id: string; conversation_id: string }[]>`
      SELECT id, conversation_id
      FROM ai.turns
      WHERE status = 'queued'
        AND cancel_requested_at IS NULL
        AND created_at < now() - (${SWEEP_STALE_QUEUED_MS} * interval '1 millisecond')
        AND (heartbeat_at IS NULL OR heartbeat_at < now() - (${SWEEP_STALE_QUEUED_MS} * interval '1 millisecond'))
      LIMIT ${limit}
    `;

    const requeueIds = new Set<string>();
    for (const row of [...requeuedRows, ...staleQueuedRows]) {
      if (requeueIds.has(row.id)) continue;
      requeueIds.add(row.id);
      result.requeued.push({ conversationId: row.conversation_id, turnId: row.id });
    }

    return result;
  },

  savePendingTurnAction: async (input) => {
    await sql`
      INSERT INTO ai.pending_actions (
        turn_id,
        conversation_id,
        call_id,
        kind,
        tool_name,
        args,
        message,
        approval_scope,
        allow_always,
        frontend_mode,
        status,
        resolved_event,
        resolved_at
      )
      VALUES (
        ${input.turnId},
        ${input.conversationId},
        ${input.callId},
        ${input.kind},
        ${input.name},
        ${JSON.stringify(input.args ?? null)}::jsonb,
        ${input.message ?? null},
        ${input.approvalScope},
        ${input.allowAlways},
        ${input.frontendMode ?? null},
        ${input.resolvedEvent ? "resolved" : "pending"},
        ${input.resolvedEvent ? JSON.stringify(input.resolvedEvent) : null}::jsonb,
        CASE WHEN ${Boolean(input.resolvedEvent)} THEN now() ELSE NULL END
      )
      ON CONFLICT (turn_id, call_id)
      DO UPDATE SET
        kind = EXCLUDED.kind,
        tool_name = EXCLUDED.tool_name,
        args = EXCLUDED.args,
        message = EXCLUDED.message,
        approval_scope = EXCLUDED.approval_scope,
        allow_always = EXCLUDED.allow_always,
        frontend_mode = EXCLUDED.frontend_mode
    `;
  },

  listPendingTurnActions: async (input) => {
    const rows = await sql<PendingActionRow[]>`
      SELECT *
      FROM ai.pending_actions
      WHERE conversation_id = ${input.conversationId}
        AND turn_id = ${input.turnId}
        AND status = 'pending'
      ORDER BY created_at ASC
    `;
    return rows.map(pendingActionToPublicEvent);
  },

  getPendingTurnAction: async (input) => {
    const rows = await sql<PendingActionRow[]>`
      SELECT *
      FROM ai.pending_actions
      WHERE conversation_id = ${input.conversationId}
        AND turn_id = ${input.turnId}
        AND call_id = ${input.callId}
      LIMIT 1
    `;
    return rows[0] ? rowToPendingActionRecord(rows[0]) : null;
  },

  listPendingActionRecords: async (input) => {
    const rows = await sql<PendingActionRow[]>`
      SELECT *
      FROM ai.pending_actions
      WHERE conversation_id = ${input.conversationId}
        AND turn_id = ${input.turnId}
        AND status = 'pending'
      ORDER BY created_at ASC
    `;
    return rows.map(rowToPendingActionRecord);
  },

  listResolvedPendingActions: async (input) => {
    const rows = await sql<PendingActionRow[]>`
      SELECT *
      FROM ai.pending_actions
      WHERE conversation_id = ${input.conversationId}
        AND turn_id = ${input.turnId}
        AND status = 'resolved'
      ORDER BY created_at ASC
    `;
    return rows.map(rowToPendingActionRecord);
  },

  resolvePendingTurnAction: async (input) => {
    const rows = await sql<PendingActionRow[]>`
      UPDATE ai.pending_actions
      SET status = 'resolved',
          resolved_event = ${JSON.stringify(input.event)}::jsonb,
          resolved_at = now()
      WHERE conversation_id = ${input.conversationId}
        AND turn_id = ${input.turnId}
        AND call_id = ${input.callId}
        AND status = 'pending'
      RETURNING *
    `;
    return rows[0] ? rowToPendingActionRecord(rows[0]) : null;
  },

  clearPendingTurnActions: async (input) => {
    await sql`
      UPDATE ai.pending_actions
      SET status = 'aborted',
          resolved_at = COALESCE(resolved_at, now())
      WHERE conversation_id = ${input.conversationId}
        AND turn_id = ${input.turnId}
        AND status = 'pending'
    `;
  },

  createSessionStore: (input): SessionStore => ({
    load: async (): Promise<StoreEntry[]> => {
      const rows = await aiConversationStore.listMessages({ conversationId: input.conversationId });
      return rows.map((row) => ({ seq: row.seq, kind: row.kind, message: row.message }));
    },
    append: async (message, opts) => {
      // User messages are persisted transactionally at submit time; the loop must never re-append them.
      if (message.role === "user") return;

      if (input.turnId && input.leaseOwner) {
        const appended = await appendTurnOwnedMessage({
          conversationId: input.conversationId,
          turnId: input.turnId,
          leaseOwner: input.leaseOwner,
          message,
          kind: opts?.kind,
          seq: opts?.seq,
          loopId: opts?.kind === "summary" ? null : input.turnId,
          modelProfileId: input.modelProfileId,
        });
        if (!appended) {
          throw new Error("AI turn lost its lease while writing a message.");
        }
        return;
      }

      await sql.begin(async () => {
        await sql`SELECT id FROM ai.conversations WHERE id = ${input.conversationId} FOR UPDATE`;
        await insertMessageLocked({
          conversationId: input.conversationId,
          message,
          kind: opts?.kind,
          seq: opts?.seq,
          loopId: input.turnId && opts?.kind !== "summary" ? input.turnId : null,
          modelProfileId: input.modelProfileId,
        });
      });
    },
  }),
};
