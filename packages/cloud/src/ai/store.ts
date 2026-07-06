import type { DoneReason, InboundEvent, LoopAggregate, Message, SessionStore, StoreEntry } from "@valentinkolb/nessi";
import type { Usage } from "@valentinkolb/nessi/ai";
import { sql } from "bun";
import type {
  AiConversation,
  AiConversationPage,
  AiConversationResource,
  AiConversationStore,
  AiFrontendToolMode,
  AiPendingTurnAction,
  AiPendingTurnActionRecord,
  AiSseEvent,
  AiStoredMessage,
  AiStoredTurnEvent,
  AiStreamEvent,
  AiTurn,
  AiTurnRunConfig,
  AiTurnStatus,
} from "./types";

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
  model_profile_id: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  error: string | null;
  run_config?: unknown;
};

type TurnRunConfigRow = {
  run_config: unknown | null;
};

type TurnEventRow = {
  seq: number | string;
  event: unknown;
  created_at: Date | string;
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
  modelProfileId: row.model_profile_id,
  createdAt: iso(row.created_at),
  completedAt: row.completed_at ? iso(row.completed_at) : null,
  error: row.error,
});

const rowToStoredTurnEvent = (row: TurnEventRow): AiStoredTurnEvent => {
  const seq = Number(row.seq);
  const event = parseJsonValue<AiStreamEvent>(row.event);
  return { ...event, cursor: String(seq), seq, createdAt: iso(row.created_at) };
};

const pendingActionToPublicEvent = (row: PendingActionRow): AiPendingTurnAction =>
  row.kind === "client_tool"
    ? {
        type: "frontend_tool",
        turnId: row.turn_id,
        conversationId: row.conversation_id,
        loopId: row.turn_id,
        callId: row.call_id,
        name: row.tool_name,
        args: parseJsonValue(row.args),
        mode: row.frontend_mode ?? "client",
      }
    : {
        type: "approval_request",
        turnId: row.turn_id,
        conversationId: row.conversation_id,
        loopId: row.turn_id,
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

const seqAfterCursor = (cursor: string | null | undefined): number => {
  if (!cursor || cursor === "0-0") return 0;
  const numericPrefix = /^[0-9]+/.exec(cursor)?.[0];
  if (!numericPrefix) return 0;
  const seq = Number(numericPrefix);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
};

const boundedLeaseMs = (leaseMs: number | undefined): number => {
  if (!Number.isFinite(leaseMs ?? NaN)) return 60_000;
  return Math.min(Math.max(Math.floor(leaseMs!), 5_000), 5 * 60_000);
};

const expireStaleTurns = async (conversationId?: string): Promise<number> => {
  const rows = await sql<{ count: number }[]>`
    WITH expired AS (
      UPDATE ai.turns
      SET lease_owner = NULL,
          lease_expires_at = NULL
      WHERE status = 'running'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < now()
        AND (${conversationId ?? null}::uuid IS NULL OR conversation_id = ${conversationId ?? null})
      RETURNING id
    )
    SELECT COUNT(*)::int AS count FROM expired
  `;
  return rows[0]?.count ?? 0;
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

const appendMessage = async (input: {
  conversationId: string;
  message: Message;
  kind?: "message" | "summary";
  seq?: number;
  loopId?: string | null;
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
        >`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM ai.messages WHERE conversation_id = ${input.conversationId} AND seq > 0`;
    const seq = seqRows[0]?.seq ?? 1;

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
        ${stopReason},
        NULL,
        NULL
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
          AND (${loopId}::text IS NULL OR loop_id = ${loopId} OR loop_id IS NULL)
        ORDER BY
          CASE WHEN ${loopId}::text IS NOT NULL AND loop_id = ${loopId} THEN 0 ELSE 1 END,
          seq DESC
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
        WITH seq_floor AS (
          SELECT LEAST(COALESCE(MIN(seq), 0), 0) AS min_seq
          FROM ai.messages
          WHERE conversation_id = ${input.conversationId}
        ),
        candidates AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY seq DESC) AS rn
          FROM ai.messages
          WHERE conversation_id = ${input.conversationId}
            AND compacted_at IS NULL
            AND seq <= ${checkpointSeq}
        )
        UPDATE ai.messages AS message
        SET seq = seq_floor.min_seq - candidates.rn,
            compacted_at = now()
        FROM candidates, seq_floor
        WHERE message.id = candidates.id
      `;

      const usage = input.summary.role === "assistant" ? (input.summary.usage ?? null) : null;
      const providerModel = input.summary.role === "assistant" ? (input.summary.model ?? null) : null;
      const stopReason = input.summary.role === "assistant" ? (input.summary.stopReason ?? null) : null;
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
        VALUES (
          ${input.conversationId},
          ${checkpointSeq},
          'summary',
          ${input.summary.role},
          ${JSON.stringify(input.summary)}::jsonb,
          NULL,
          ${input.modelProfileId ?? null},
          ${providerModel},
          ${usage ? JSON.stringify(usage) : null}::jsonb,
          ${stopReason},
          NULL,
          NULL
        )
      `;
      await sql`UPDATE ai.conversations SET updated_at = now() WHERE id = ${input.conversationId}`;
    });
  },

  createTurn: async (input) => {
    await expireStaleTurns(input.conversationId);
    const leaseMs = boundedLeaseMs(input.leaseMs);
    const rows = await sql<TurnRow[]>`
      INSERT INTO ai.turns (
        conversation_id,
        model_profile_id,
        lease_owner,
        lease_expires_at,
        heartbeat_at,
        run_config
      )
      VALUES (
        ${input.conversationId},
        ${input.modelProfileId},
        ${input.leaseOwner ?? null},
        now() + (${leaseMs} * interval '1 millisecond'),
        now(),
        ${input.runConfig ? JSON.stringify(input.runConfig) : null}::jsonb
      )
      RETURNING *
    `;
    return rowToTurn(rows[0]!);
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

  getTurnRunConfig: async (input) => {
    const rows = await sql<TurnRunConfigRow[]>`
      SELECT run_config
      FROM ai.turns
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
      LIMIT 1
    `;
    return rows[0]?.run_config ? parseJsonValue<AiTurnRunConfig>(rows[0].run_config) : null;
  },

  getRunningTurn: async (input) => {
    await expireStaleTurns(input.conversationId);
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

  listRecoverableTurns: async (input) => {
    await expireStaleTurns();
    const limit = Math.min(Math.max(Math.floor(input?.limit ?? 100), 1), 500);
    const rows = await sql<TurnRow[]>`
      SELECT *
      FROM ai.turns
      WHERE status = 'running'
        AND (lease_owner IS NULL OR lease_owner = 'queued')
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map(rowToTurn);
  },

  claimTurnLease: async (input) => {
    const leaseMs = boundedLeaseMs(input.leaseMs);
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.turns
      SET heartbeat_at = now(),
          lease_owner = ${input.leaseOwner},
          lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
        AND status = 'running'
        AND (
          lease_owner IS NULL
          OR lease_owner = 'queued'
          OR lease_owner = ${input.leaseOwner}
          OR lease_expires_at IS NULL
          OR lease_expires_at < now()
        )
      RETURNING id
    `;
    return Boolean(rows[0]);
  },

  heartbeatTurn: async (input) => {
    const leaseMs = boundedLeaseMs(input.leaseMs);
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.turns
      SET heartbeat_at = now(),
          lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
        AND lease_owner = ${input.leaseOwner}
        AND status = 'running'
      RETURNING id
    `;
    return Boolean(rows[0]);
  },

  expireStaleTurns: (input) => expireStaleTurns(input?.conversationId),

  requestTurnAbort: async (input) => {
    await expireStaleTurns(input.conversationId);
    const reason = input.reason ?? "user";
    const updated = await sql<TurnRow[]>`
      UPDATE ai.turns
      SET status = 'aborted',
          completed_at = COALESCE(completed_at, now()),
          error = NULL,
          cancel_requested_at = COALESCE(cancel_requested_at, now()),
          cancellation_reason = COALESCE(cancellation_reason, ${reason}),
          lease_owner = NULL,
          lease_expires_at = NULL
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
        AND status = 'running'
      RETURNING *
    `;
    if (updated[0]) return { found: true, status: updated[0].status, aborted: true };

    const existing = await sql<TurnRow[]>`
      SELECT *
      FROM ai.turns
      WHERE id = ${input.turnId}
        AND conversation_id = ${input.conversationId}
      LIMIT 1
    `;
    return existing[0] ? { found: true, status: existing[0].status, aborted: false } : { found: false, status: null, aborted: false };
  },

  isTurnRunning: async (input) => {
    const rows = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM ai.turns
        WHERE id = ${input.turnId}
          AND conversation_id = ${input.conversationId}
          AND status = 'running'
      ) AS exists
    `;
    return Boolean(rows[0]?.exists);
  },

  isTurnLeaseOwner: async (input) => {
    const rows = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM ai.turns
        WHERE id = ${input.turnId}
          AND conversation_id = ${input.conversationId}
          AND lease_owner = ${input.leaseOwner}
          AND status = 'running'
      ) AS exists
    `;
    return Boolean(rows[0]?.exists);
  },

  completeTurn: async (input) => {
    await sql`
      UPDATE ai.turns
      SET status = ${input.status},
          completed_at = now(),
          error = ${input.error ?? null},
          lease_owner = NULL,
          lease_expires_at = NULL
      WHERE id = ${input.turnId}
        AND status = 'running'
        AND (${input.leaseOwner ?? null}::text IS NULL OR lease_owner = ${input.leaseOwner ?? null})
    `;
  },

  appendTurnEvent: async (input) => {
    const eventType = input.event.type;
    const rows = await sql<TurnEventRow[]>`
      INSERT INTO ai.turn_events (conversation_id, turn_id, event_type, event)
      SELECT ${input.event.conversationId}, ${input.event.turnId}, ${eventType}, ${input.event}::jsonb
      WHERE EXISTS (
        SELECT 1
        FROM ai.turns
        WHERE id = ${input.event.turnId}
          AND conversation_id = ${input.event.conversationId}
          AND (
            status = 'running'
            OR ${eventType} IN ('done', 'error')
          )
      )
      ON CONFLICT DO NOTHING
      RETURNING seq, event, created_at
    `;
    if (rows[0]) return rowToStoredTurnEvent(rows[0]);
    if (eventType !== "done" && eventType !== "error") return null;

    const existing = await sql<TurnEventRow[]>`
      SELECT seq, event, created_at
      FROM ai.turn_events
      WHERE turn_id = ${input.event.turnId}
        AND event_type IN ('done', 'error')
      ORDER BY seq ASC
      LIMIT 1
    `;
    return existing[0] ? rowToStoredTurnEvent(existing[0]) : null;
  },

  listTurnEvents: async (input) => {
    const after = seqAfterCursor(input.after);
    const limit = Math.min(Math.max(Math.floor(input.limit ?? 500), 1), 1_000);
    const rows = await sql<TurnEventRow[]>`
      SELECT seq, event, created_at
      FROM ai.turn_events
      WHERE conversation_id = ${input.conversationId}
        AND (${input.turnId ?? null}::uuid IS NULL OR turn_id = ${input.turnId ?? null})
        AND seq > ${after}
      ORDER BY seq ASC
      LIMIT ${limit}
    `;
    return rows.map(rowToStoredTurnEvent);
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
      if (input.turnId && message.role !== "user") {
        const running = await aiConversationStore.isTurnRunning({ conversationId: input.conversationId, turnId: input.turnId });
        if (!running) return;
      }
      const loopId = input.turnId && message.role !== "user" && opts?.kind !== "summary" ? input.turnId : null;
      await appendMessage({
        conversationId: input.conversationId,
        message,
        kind: opts?.kind,
        seq: opts?.seq,
        loopId,
        modelProfileId: input.modelProfileId,
      });
    },
  }),
};
