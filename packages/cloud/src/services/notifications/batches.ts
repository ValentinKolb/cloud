import { sql } from "bun";
import { createHash } from "node:crypto";
import { job } from "@valentinkolb/sync";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { markdown } from "../../shared/markdown";
import { logger } from "../logging";
import { parsePgJsonValue, toPgTextArray, toPgUuidArray } from "../postgres";
import { sendEmail } from "./email";

const log = logger("notifications:batches");
const CHUNK_SIZE = 100;
const MAX_PAGE = 10_000;
const MAX_PER_PAGE = 100;

export type NotificationBatchStatus = "draft" | "ready" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
export type NotificationBatchRecipientStatus = "pending" | "sending" | "sent" | "skipped" | "error";
export type NotificationBatchSelectionMode = "specific" | "rules";
export type NotificationBatchRule = "account_manager" | "local" | "ipa" | "guest" | "user";

export type NotificationBatchSelection = {
  mode?: NotificationBatchSelectionMode;
  rules?: NotificationBatchRule[];
  all?: boolean;
  userIds?: string[];
  groupIds?: string[];
  includeGroupMembers?: boolean;
  accountManagers?: {
    mode?: "none" | "all" | "groups";
    groupIds?: string[];
    recursive?: boolean;
  };
  providers?: ("local" | "ipa")[];
  profiles?: ("user" | "guest")[];
};

export type NotificationBatchPreview = {
  targetCount: number;
  deliverableCount: number;
  skippedNoEmailCount: number;
  duplicateCount: number;
  recipientHash: string;
};

export type NotificationBatch = {
  id: string;
  subject: string;
  bodyMarkdown: string;
  bodyHtml: string;
  selection: NotificationBatchSelection;
  selectionHash: string;
  status: NotificationBatchStatus;
  createdBy: string | null;
  finalizedBy: string | null;
  createdAt: string;
  finalizedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  targetCount: number;
  deliverableCount: number;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  lastError: string | null;
};

export type NotificationBatchRecipient = {
  batchId: string;
  userId: string;
  recipient: string | null;
  uid: string;
  displayName: string;
  avatarHash: string | null;
  provider: "local" | "ipa";
  profile: "user" | "guest";
  status: NotificationBatchRecipientStatus;
  notificationId: string | null;
  error: string | null;
  attemptCount: number;
  sentAt: string | null;
  updatedAt: string;
};

type RecipientCandidate = {
  id: string;
  uid: string;
  display_name: string;
  mail: string | null;
  provider: "local" | "ipa";
  profile: "user" | "guest";
  source_hits: number;
};

type BatchRow = Record<string, unknown>;

const normalizeIds = (values: string[] | null | undefined): string[] => [...new Set((values ?? []).filter(Boolean))].sort();
const normalizeRules = (values: NotificationBatchRule[] | null | undefined): NotificationBatchRule[] =>
  normalizeIds(values).filter(
    (value): value is NotificationBatchRule =>
      value === "account_manager" || value === "local" || value === "ipa" || value === "guest" || value === "user",
  );

const normalizeSelection = (selection: NotificationBatchSelection): NotificationBatchSelection => {
  const providers = normalizeIds(selection.providers).filter((value): value is "local" | "ipa" => value === "local" || value === "ipa");
  const profiles = normalizeIds(selection.profiles).filter((value): value is "user" | "guest" => value === "user" || value === "guest");
  const managerMode = selection.accountManagers?.mode ?? "none";
  return {
    mode: selection.mode === "specific" || selection.mode === "rules" ? selection.mode : undefined,
    rules: normalizeRules(selection.rules),
    all: Boolean(selection.all),
    userIds: normalizeIds(selection.userIds),
    groupIds: normalizeIds(selection.groupIds),
    includeGroupMembers: selection.includeGroupMembers !== false,
    accountManagers: {
      mode: managerMode,
      groupIds: normalizeIds(selection.accountManagers?.groupIds),
      recursive: selection.accountManagers?.recursive !== false,
    },
    providers,
    profiles,
  };
};

const selectionHash = (selection: NotificationBatchSelection): string =>
  createHash("sha256")
    .update(JSON.stringify(normalizeSelection(selection)))
    .digest("hex");

const recipientHash = (candidates: RecipientCandidate[]): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        candidates
          .filter((candidate) => candidate.mail)
          .map((candidate) => candidate.id)
          .sort(),
      ),
    )
    .digest("hex");

const mapBatch = (row: BatchRow): NotificationBatch => ({
  id: row.id as string,
  subject: row.subject as string,
  bodyMarkdown: row.body_markdown as string,
  bodyHtml: row.body_html as string,
  selection: (parsePgJsonValue(row.selection) ?? {}) as NotificationBatchSelection,
  selectionHash: row.selection_hash as string,
  status: row.status as NotificationBatchStatus,
  createdBy: row.created_by as string | null,
  finalizedBy: row.finalized_by as string | null,
  createdAt: (row.created_at as Date).toISOString(),
  finalizedAt: row.finalized_at ? (row.finalized_at as Date).toISOString() : null,
  startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
  completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : null,
  targetCount: Number(row.target_count ?? 0),
  deliverableCount: Number(row.deliverable_count ?? 0),
  sentCount: Number(row.sent_count ?? 0),
  skippedCount: Number(row.skipped_count ?? 0),
  errorCount: Number(row.error_count ?? 0),
  lastError: row.last_error as string | null,
});

const mapRecipient = (row: BatchRow): NotificationBatchRecipient => ({
  batchId: row.batch_id as string,
  userId: row.user_id as string,
  recipient: row.recipient as string | null,
  uid: row.uid as string,
  displayName: row.display_name as string,
  avatarHash: (row.avatar_hash as string | null | undefined) ?? null,
  provider: row.provider as "local" | "ipa",
  profile: row.profile as "user" | "guest",
  status: row.status as NotificationBatchRecipientStatus,
  notificationId: row.notification_id as string | null,
  error: row.error as string | null,
  attemptCount: Number(row.attempt_count ?? 0),
  sentAt: row.sent_at ? (row.sent_at as Date).toISOString() : null,
  updatedAt: (row.updated_at as Date).toISOString(),
});

const resolveCandidates = async (rawSelection: NotificationBatchSelection): Promise<RecipientCandidate[]> => {
  const selection = normalizeSelection(rawSelection);
  const userIds = selection.userIds ?? [];
  const groupIds = selection.groupIds ?? [];
  const rules = selection.rules ?? [];

  if (selection.mode === "specific") {
    if (userIds.length === 0) return [];
    return await sql<RecipientCandidate[]>`
      SELECT u.id, u.uid, u.display_name, u.mail, u.provider, u.profile, 1::int AS source_hits
      FROM auth.users u
      WHERE u.id = ANY(${toPgUuidArray(userIds)}::uuid[])
      ORDER BY u.uid
    `;
  }

  if (selection.mode === "rules") {
    const providerRules = rules.filter((rule): rule is "local" | "ipa" => rule === "local" || rule === "ipa");
    const profileRules = rules.filter((rule): rule is "user" | "guest" => rule === "user" || rule === "guest");
    const providers = providerRules;
    const profiles = profileRules;
    const requiresAccountManager = rules.includes("account_manager");
    return await sql<RecipientCandidate[]>`
      WITH RECURSIVE
        selected_groups(group_id) AS (
          SELECT unnest(${toPgUuidArray(groupIds)}::uuid[])
        ),
        scope_group_tree(group_id) AS (
          SELECT group_id FROM selected_groups
          UNION
          SELECT gg.child_group_id
          FROM auth.group_groups_v2 gg
          JOIN scope_group_tree tree ON tree.group_id = gg.parent_group_id
        ),
        scoped_users(user_id) AS (
          SELECT u.id
          FROM auth.users u
          WHERE ${groupIds.length === 0}
          UNION
          SELECT ug.user_id
          FROM auth.user_groups_v2 ug
          JOIN scope_group_tree tree ON tree.group_id = ug.group_id
        ),
        user_all_groups(user_id, group_id) AS (
          SELECT ug.user_id, ug.group_id
          FROM auth.user_groups_v2 ug
          UNION
          SELECT ag.user_id, gg.parent_group_id
          FROM auth.group_groups_v2 gg
          JOIN user_all_groups ag ON ag.group_id = gg.child_group_id
        ),
        manager_seed_groups(group_id) AS (
          SELECT gmg.manager_group_id
          FROM auth.group_manager_groups_v2 gmg
          WHERE ${groupIds.length === 0}
          UNION
          SELECT gmg.manager_group_id
          FROM auth.group_manager_groups_v2 gmg
          JOIN scope_group_tree tree ON tree.group_id = gmg.group_id
          WHERE ${groupIds.length > 0}
        ),
        manager_group_tree(group_id) AS (
          SELECT group_id FROM manager_seed_groups
          UNION
          SELECT gg.parent_group_id
          FROM auth.group_groups_v2 gg
          JOIN manager_group_tree tree ON tree.group_id = gg.child_group_id
        ),
        manager_users(user_id) AS (
          SELECT gmu.user_id
          FROM auth.group_manager_users_v2 gmu
          WHERE ${groupIds.length === 0}
          UNION
          SELECT gmu.user_id
          FROM auth.group_manager_users_v2 gmu
          JOIN scope_group_tree tree ON tree.group_id = gmu.group_id
          WHERE ${groupIds.length > 0}
          UNION
          SELECT ag.user_id
          FROM user_all_groups ag
          JOIN manager_group_tree tree ON tree.group_id = ag.group_id
        ),
        candidate_counts AS (
          SELECT su.user_id, 1::int AS source_hits
          FROM scoped_users su
          WHERE ${!requiresAccountManager}
          UNION
          SELECT mu.user_id, 1::int AS source_hits
          FROM manager_users mu
          WHERE ${requiresAccountManager}
        )
      SELECT u.id, u.uid, u.display_name, u.mail, u.provider, u.profile, c.source_hits
      FROM candidate_counts c
      JOIN auth.users u ON u.id = c.user_id
      WHERE (cardinality(${toPgTextArray(providers)}::text[]) = 0 OR u.provider = ANY(${toPgTextArray(providers)}::text[]))
        AND (cardinality(${toPgTextArray(profiles)}::text[]) = 0 OR u.profile = ANY(${toPgTextArray(profiles)}::text[]))
      ORDER BY u.uid
    `;
  }

  const managerGroupIds = selection.accountManagers?.groupIds ?? [];
  const providers = selection.providers ?? [];
  const profiles = selection.profiles ?? [];
  const managerMode = selection.accountManagers?.mode ?? "none";
  const includeMembers = selection.includeGroupMembers !== false;
  const recursiveManagers = selection.accountManagers?.recursive !== false;
  const hasAnySource =
    selection.all ||
    userIds.length > 0 ||
    (includeMembers && groupIds.length > 0) ||
    managerMode === "all" ||
    (managerMode === "groups" && managerGroupIds.length > 0);

  if (!hasAnySource) return [];

  return await sql<RecipientCandidate[]>`
    WITH RECURSIVE
      selected_users(user_id) AS (
        SELECT unnest(${toPgUuidArray(userIds)}::uuid[])
      ),
      selected_groups(group_id) AS (
        SELECT unnest(${toPgUuidArray(groupIds)}::uuid[])
      ),
      selected_manager_groups(group_id) AS (
        SELECT unnest(${toPgUuidArray(managerGroupIds)}::uuid[])
      ),
      member_group_tree(group_id) AS (
        SELECT group_id FROM selected_groups
        UNION
        SELECT gg.child_group_id
        FROM auth.group_groups_v2 gg
        JOIN member_group_tree tree ON tree.group_id = gg.parent_group_id
        WHERE ${includeMembers}
      ),
      user_all_groups(user_id, group_id) AS (
        SELECT ug.user_id, ug.group_id
        FROM auth.user_groups_v2 ug
        UNION
        SELECT ag.user_id, gg.parent_group_id
        FROM auth.group_groups_v2 gg
        JOIN user_all_groups ag ON ag.group_id = gg.child_group_id
      ),
      manager_seed_groups(group_id) AS (
        SELECT gmg.manager_group_id
        FROM auth.group_manager_groups_v2 gmg
        WHERE ${managerMode === "all"}
        UNION
        SELECT gmg.manager_group_id
        FROM auth.group_manager_groups_v2 gmg
        JOIN selected_manager_groups sg ON sg.group_id = gmg.group_id
        WHERE ${managerMode === "groups"}
      ),
      manager_group_tree(group_id) AS (
        SELECT group_id FROM manager_seed_groups
        UNION
        SELECT gg.parent_group_id
        FROM auth.group_groups_v2 gg
        JOIN manager_group_tree tree ON tree.group_id = gg.child_group_id
        WHERE ${recursiveManagers}
      ),
      candidates(user_id) AS (
        SELECT u.id
        FROM auth.users u
        WHERE ${Boolean(selection.all)}
        UNION ALL
        SELECT user_id FROM selected_users
        UNION ALL
        SELECT ug.user_id
        FROM auth.user_groups_v2 ug
        JOIN member_group_tree tree ON tree.group_id = ug.group_id
        WHERE ${includeMembers}
        UNION ALL
        SELECT gmu.user_id
        FROM auth.group_manager_users_v2 gmu
        WHERE ${managerMode === "all"}
        UNION ALL
        SELECT gmu.user_id
        FROM auth.group_manager_users_v2 gmu
        JOIN selected_manager_groups sg ON sg.group_id = gmu.group_id
        WHERE ${managerMode === "groups"}
        UNION ALL
        SELECT ag.user_id
        FROM user_all_groups ag
        JOIN manager_group_tree tree ON tree.group_id = ag.group_id
        WHERE ${managerMode === "all" || managerMode === "groups"}
      ),
      candidate_counts AS (
        SELECT user_id, COUNT(*)::int AS source_hits
        FROM candidates
        GROUP BY user_id
      )
    SELECT u.id, u.uid, u.display_name, u.mail, u.provider, u.profile, c.source_hits
    FROM candidate_counts c
    JOIN auth.users u ON u.id = c.user_id
    WHERE (cardinality(${toPgTextArray(providers)}::text[]) = 0 OR u.provider = ANY(${toPgTextArray(providers)}::text[]))
      AND (cardinality(${toPgTextArray(profiles)}::text[]) = 0 OR u.profile = ANY(${toPgTextArray(profiles)}::text[]))
    ORDER BY u.uid
  `;
};

const sendBatchEmail = async (params: {
  recipient: string;
  subject: string;
  rawHtml: string;
  sentBy?: string;
}): Promise<{ id: string; status: "sent" | "error"; error?: string }> => {
  const rows = await sql<BatchRow[]>`
    INSERT INTO notifications.messages (type, recipient, subject, content, sent_by)
    VALUES ('email', ${params.recipient}, ${params.subject}, ${params.rawHtml}, ${params.sentBy ?? null})
    RETURNING id
  `;
  const id = rows[0]!.id as string;
  try {
    await sendEmail(params.recipient, params.subject, { rawHtml: params.rawHtml });
    await sql`UPDATE notifications.messages SET sent_at = now(), error = NULL WHERE id = ${id}::uuid`;
    return { id, status: "sent" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`UPDATE notifications.messages SET error = ${message} WHERE id = ${id}::uuid`;
    return { id, status: "error", error: message };
  }
};

export const preview = async (selection: NotificationBatchSelection): Promise<NotificationBatchPreview> => {
  const candidates = await resolveCandidates(selection);
  return {
    targetCount: candidates.length,
    deliverableCount: candidates.filter((candidate) => candidate.mail).length,
    skippedNoEmailCount: candidates.filter((candidate) => !candidate.mail).length,
    duplicateCount: candidates.reduce((sum, candidate) => sum + Math.max(0, Number(candidate.source_hits ?? 1) - 1), 0),
    recipientHash: recipientHash(candidates),
  };
};

const refreshBatchCounters = async (batchId: string): Promise<NotificationBatch | null> => {
  const rows = await sql<BatchRow[]>`
    WITH counts AS (
      SELECT
        COUNT(*)::int AS target_count,
        COUNT(*) FILTER (WHERE r.recipient IS NOT NULL)::int AS deliverable_count,
        COUNT(*) FILTER (WHERE r.status = 'sent')::int AS sent_count,
        COUNT(*) FILTER (WHERE r.status = 'skipped')::int AS skipped_count,
        COUNT(*) FILTER (WHERE r.status = 'error')::int AS error_count,
        COUNT(*) FILTER (WHERE r.status IN ('pending', 'sending'))::int AS pending_count,
        MAX(COALESCE(m.error, r.error)) FILTER (WHERE r.status = 'error') AS last_error
      FROM notifications.batch_recipients r
      LEFT JOIN notifications.messages m ON m.id = r.notification_id
      WHERE r.batch_id = ${batchId}::uuid
    )
    UPDATE notifications.batches b
    SET
      target_count = counts.target_count,
      deliverable_count = counts.deliverable_count,
      sent_count = counts.sent_count,
      skipped_count = counts.skipped_count,
      error_count = counts.error_count,
      last_error = counts.last_error,
      status = CASE
        WHEN b.status IN ('draft', 'ready', 'cancelled') THEN b.status
        WHEN counts.pending_count > 0 THEN 'running'
        WHEN counts.error_count > 0 THEN 'completed_with_errors'
        ELSE 'completed'
      END,
      completed_at = CASE
        WHEN b.status IN ('draft', 'ready', 'cancelled') THEN b.completed_at
        WHEN counts.pending_count = 0 AND b.completed_at IS NULL THEN now()
        ELSE b.completed_at
      END
    FROM counts
    WHERE b.id = ${batchId}::uuid
    RETURNING b.*
  `;
  return rows[0] ? mapBatch(rows[0]) : null;
};

const processBatchChunk = async (batchId: string): Promise<{ processed: number; remaining: number }> => {
  await sql`
    UPDATE notifications.batches
    SET status = 'running', started_at = COALESCE(started_at, now())
    WHERE id = ${batchId}::uuid AND status IN ('ready', 'running')
  `;

  const recipients = await sql<BatchRow[]>`
    UPDATE notifications.batch_recipients r
    SET status = 'sending', attempt_count = attempt_count + 1, updated_at = now()
    WHERE (r.batch_id, r.user_id) IN (
      SELECT batch_id, user_id
      FROM notifications.batch_recipients
      WHERE batch_id = ${batchId}::uuid
        AND recipient IS NOT NULL
        AND (
          status = 'pending'
          OR (status = 'sending' AND updated_at < now() - interval '5 minutes')
        )
      ORDER BY updated_at ASC
      LIMIT ${CHUNK_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING r.*
  `;

  const [batchRow] = await sql<BatchRow[]>`SELECT * FROM notifications.batches WHERE id = ${batchId}::uuid`;
  if (!batchRow || batchRow.status === "cancelled") return { processed: 0, remaining: 0 };
  const batch = mapBatch(batchRow);

  for (const recipient of recipients) {
    try {
      const result = await sendBatchEmail({
        recipient: recipient.recipient as string,
        subject: batch.subject,
        rawHtml: batch.bodyHtml,
        sentBy: batch.finalizedBy ?? batch.createdBy ?? undefined,
      });
      await sql`
        UPDATE notifications.batch_recipients
        SET
          status = ${result.status === "sent" ? "sent" : "error"},
          notification_id = ${result.id}::uuid,
          error = NULL,
          sent_at = ${result.status === "sent" ? sql`now()` : null},
          updated_at = now()
        WHERE batch_id = ${batchId}::uuid AND user_id = ${recipient.user_id}::uuid
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("Batch recipient send failed", { batchId, userId: recipient.user_id, error: message });
      await sql`
        UPDATE notifications.batch_recipients
        SET status = 'error', error = ${message}, updated_at = now()
        WHERE batch_id = ${batchId}::uuid AND user_id = ${recipient.user_id}::uuid
      `;
    }
  }

  const [pendingRow] = await sql<BatchRow[]>`
    SELECT COUNT(*)::int AS count
    FROM notifications.batch_recipients
    WHERE batch_id = ${batchId}::uuid
      AND recipient IS NOT NULL
      AND status IN ('pending', 'sending')
  `;
  const remaining = Number(pendingRow?.count ?? 0);
  await refreshBatchCounters(batchId);
  return { processed: recipients.length, remaining };
};

const batchJob = job<{ batchId: string }, { processed: number; remaining: number }>({
  id: "notifications:batches",
  defaults: { leaseMs: 180_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return { processed: 0, remaining: 0 };
    const result = await processBatchChunk(ctx.input.batchId);
    await ctx.heartbeat();
    return result;
  },
  after: async ({ ctx }) => {
    if (ctx.error && ctx.failureCount < 3) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 1000, maxMs: 30_000 }) });
      return;
    }
    if (ctx.error) {
      const message = ctx.error.message;
      log.error("Notification batch job failed", { batchId: ctx.input.batchId, failureCount: ctx.failureCount, error: message });
      await sql`
        UPDATE notifications.batches
        SET status = 'failed', completed_at = now(), last_error = ${message}
        WHERE id = ${ctx.input.batchId}::uuid AND status IN ('ready', 'running')
      `;
      return;
    }
    if (ctx.data && ctx.data.remaining > 0) {
      ctx.reschedule({ delayMs: ctx.data.processed > 0 ? 0 : 60_000 });
    }
  },
});

export const createDraft = async (params: {
  subject: string;
  bodyMarkdown: string;
  selection: NotificationBatchSelection;
  createdBy: string;
}): Promise<Result<NotificationBatch>> => {
  const subject = params.subject.trim();
  const bodyMarkdown = params.bodyMarkdown.trim();
  if (!subject) return fail(err.badInput("Subject is required"));
  if (!bodyMarkdown) return fail(err.badInput("Message is required"));
  const selection = normalizeSelection(params.selection);
  const candidates = await resolveCandidates(selection);
  if (!candidates.some((candidate) => candidate.mail)) {
    return fail(err.badInput("No deliverable recipients match this selection"));
  }
  const hash = selectionHash(selection);
  const bodyHtml = markdown.renderSync(bodyMarkdown);
  const rows = await sql<BatchRow[]>`
    INSERT INTO notifications.batches (subject, body_markdown, body_html, selection, selection_hash, created_by)
    VALUES (${subject}, ${bodyMarkdown}, ${bodyHtml}, ${JSON.stringify(selection)}::jsonb, ${hash}, ${params.createdBy}::uuid)
    RETURNING *
  `;
  return ok(mapBatch(rows[0]!));
};

export const get = async (id: string): Promise<NotificationBatch | null> => {
  const rows = await sql<BatchRow[]>`SELECT * FROM notifications.batches WHERE id = ${id}::uuid`;
  return rows[0] ? mapBatch(rows[0]) : null;
};

export const list = async (params?: {
  page?: number;
  perPage?: number;
  status?: NotificationBatchStatus;
}): Promise<{ items: NotificationBatch[]; total: number; page: number; perPage: number }> => {
  const page = Math.min(Math.max(params?.page ?? 1, 1), MAX_PAGE);
  const perPage = Math.min(Math.max(params?.perPage ?? 50, 1), MAX_PER_PAGE);
  const offset = (page - 1) * perPage;
  const rows = await sql<BatchRow[]>`
    SELECT *, COUNT(*) OVER() AS total
    FROM notifications.batches
    WHERE (${params?.status ?? null}::text IS NULL OR status = ${params?.status ?? null})
    ORDER BY created_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;
  return {
    items: rows.map(mapBatch),
    total: Number(rows[0]?.total ?? 0),
    page,
    perPage,
  };
};

export const listRecipients = async (params: {
  batchId: string;
  page?: number;
  perPage?: number;
  status?: NotificationBatchRecipientStatus;
}): Promise<{ items: NotificationBatchRecipient[]; total: number; page: number; perPage: number }> => {
  const page = Math.min(Math.max(params.page ?? 1, 1), MAX_PAGE);
  const perPage = Math.min(Math.max(params.perPage ?? 100, 1), MAX_PER_PAGE);
  const offset = (page - 1) * perPage;
  const rows = await sql<BatchRow[]>`
    SELECT
      r.batch_id,
      r.user_id,
      r.recipient,
      r.uid,
      r.display_name,
      u.avatar_hash,
      r.provider,
      r.profile,
      r.status,
      r.notification_id,
      COALESCE(m.error, r.error) AS error,
      r.attempt_count,
      r.sent_at,
      r.updated_at,
      COUNT(*) OVER() AS total
    FROM notifications.batch_recipients r
    LEFT JOIN notifications.messages m ON m.id = r.notification_id
    LEFT JOIN auth.users u ON u.id = r.user_id
    WHERE r.batch_id = ${params.batchId}::uuid
      AND (${params.status ?? null}::text IS NULL OR r.status = ${params.status ?? null})
    ORDER BY
      CASE r.status WHEN 'error' THEN 0 WHEN 'pending' THEN 1 WHEN 'sending' THEN 2 WHEN 'skipped' THEN 3 ELSE 4 END,
      r.uid
    LIMIT ${perPage} OFFSET ${offset}
  `;
  return {
    items: rows.map(mapRecipient),
    total: Number(rows[0]?.total ?? 0),
    page,
    perPage,
  };
};

export const finalize = async (params: {
  id: string;
  actorUserId: string;
  expectedSelectionHash: string;
  expectedDeliverableCount: number;
  expectedRecipientHash: string;
}): Promise<Result<{ batch: NotificationBatch; jobId: string }>> => {
  const candidates = await resolveCandidates((await get(params.id))?.selection ?? {});
  const deliverableCount = candidates.filter((candidate) => candidate.mail).length;
  const currentRecipientHash = recipientHash(candidates);
  if (deliverableCount === 0) {
    return fail(err.badInput("No deliverable recipients match this batch"));
  }
  const result = await sql.begin(async (tx): Promise<Result<NotificationBatch>> => {
    const rows = await tx<BatchRow[]>`
      SELECT * FROM notifications.batches WHERE id = ${params.id}::uuid FOR UPDATE
    `;
    const batchRow = rows[0];
    if (!batchRow) return fail(err.notFound("Notification batch not found"));
    if (batchRow.status !== "draft") return fail(err.conflict("Notification batch has already been finalized"));
    if (batchRow.selection_hash !== params.expectedSelectionHash)
      return fail(err.conflict("Notification selection changed. Refresh the preview."));
    if (deliverableCount !== params.expectedDeliverableCount) {
      return fail(err.conflict("Recipient count changed. Refresh the preview before sending."));
    }
    if (currentRecipientHash !== params.expectedRecipientHash) {
      return fail(err.conflict("Recipient list changed. Refresh the preview before sending."));
    }

    await tx`
      INSERT INTO notifications.batch_recipients (
        batch_id, user_id, recipient, uid, display_name, provider, profile, status, error
      )
      SELECT
        ${params.id}::uuid,
        row.user_id,
        NULLIF(row.recipient, ''),
        row.uid,
        row.display_name,
        row.provider,
        row.profile,
        row.status,
        NULLIF(row.error, '')
      FROM unnest(
        ${toPgUuidArray(candidates.map((candidate) => candidate.id))}::uuid[],
        ${toPgTextArray(candidates.map((candidate) => candidate.mail ?? ""))}::text[],
        ${toPgTextArray(candidates.map((candidate) => candidate.uid))}::text[],
        ${toPgTextArray(candidates.map((candidate) => candidate.display_name ?? ""))}::text[],
        ${toPgTextArray(candidates.map((candidate) => candidate.provider))}::text[],
        ${toPgTextArray(candidates.map((candidate) => candidate.profile))}::text[],
        ${toPgTextArray(candidates.map((candidate) => (candidate.mail ? "pending" : "skipped")))}::text[],
        ${toPgTextArray(candidates.map((candidate) => (candidate.mail ? "" : "User has no email address")))}::text[]
      ) AS row(user_id, recipient, uid, display_name, provider, profile, status, error)
      ON CONFLICT (batch_id, user_id) DO NOTHING
    `;

    const updated = await tx<BatchRow[]>`
      UPDATE notifications.batches
      SET
        status = 'ready',
        finalized_by = ${params.actorUserId}::uuid,
        finalized_at = now(),
        target_count = ${candidates.length},
        deliverable_count = ${deliverableCount},
        skipped_count = ${candidates.length - deliverableCount}
      WHERE id = ${params.id}::uuid
      RETURNING *
    `;
    return ok(mapBatch(updated[0]!));
  });

  if (!result.ok) return result;
  const jobId = await batchJob.submit({ key: params.id, input: { batchId: params.id } });
  return ok({ batch: result.data, jobId });
};

export const retryFailed = async (params: { id: string }): Promise<Result<{ batch: NotificationBatch; jobId: string }>> => {
  const batch = await get(params.id);
  if (!batch) return fail(err.notFound("Notification batch not found"));
  if (batch.status === "draft" || batch.status === "cancelled") {
    return fail(err.conflict("Only finalized notification batches can retry recipients"));
  }

  const updated = await sql<BatchRow[]>`
    UPDATE notifications.batch_recipients
    SET status = 'pending', error = NULL, notification_id = NULL, sent_at = NULL, updated_at = now()
    WHERE batch_id = ${params.id}::uuid AND status = 'error' AND recipient IS NOT NULL
    RETURNING user_id
  `;
  if (updated.length === 0) {
    return fail(err.conflict("No failed deliverable recipients can be retried"));
  }

  await sql`
    UPDATE notifications.batches
    SET status = 'ready', completed_at = NULL, last_error = NULL
    WHERE id = ${params.id}::uuid AND status IN ('completed_with_errors', 'failed', 'running', 'ready', 'completed')
  `;
  const refreshed = await refreshBatchCounters(params.id);
  const jobId = await batchJob.submit({ key: `${params.id}:retry:${Date.now()}`, input: { batchId: params.id } });
  return ok({ batch: refreshed ?? batch, jobId });
};

export const retryRecipient = async (params: {
  id: string;
  userId: string;
}): Promise<Result<{ batch: NotificationBatch; jobId: string }>> => {
  const batch = await get(params.id);
  if (!batch) return fail(err.notFound("Notification batch not found"));
  if (batch.status === "draft" || batch.status === "cancelled") {
    return fail(err.conflict("Only finalized notification batches can retry recipients"));
  }

  const updated = await sql<BatchRow[]>`
    UPDATE notifications.batch_recipients
    SET status = 'pending', error = NULL, notification_id = NULL, sent_at = NULL, updated_at = now()
    WHERE batch_id = ${params.id}::uuid
      AND user_id = ${params.userId}::uuid
      AND status = 'error'
      AND recipient IS NOT NULL
    RETURNING *
  `;
  if (!updated[0]) {
    const existing = await sql<BatchRow[]>`
      SELECT status, recipient
      FROM notifications.batch_recipients
      WHERE batch_id = ${params.id}::uuid AND user_id = ${params.userId}::uuid
    `;
    if (!existing[0]) return fail(err.notFound("Notification recipient not found"));
    return fail(err.conflict("Only failed deliverable recipients can be retried"));
  }

  await sql`
    UPDATE notifications.batches
    SET status = 'ready', completed_at = NULL, last_error = NULL
    WHERE id = ${params.id}::uuid AND status IN ('completed_with_errors', 'failed', 'running', 'ready', 'completed')
  `;
  const refreshed = await refreshBatchCounters(params.id);
  const jobId = await batchJob.submit({ key: `${params.id}:recipient:${params.userId}:${Date.now()}`, input: { batchId: params.id } });
  return ok({ batch: refreshed ?? batch, jobId });
};

export const removeDraft = async (params: { id: string }): Promise<Result<{ id: string }>> => {
  const rows = await sql<BatchRow[]>`
    DELETE FROM notifications.batches
    WHERE id = ${params.id}::uuid AND status = 'draft'
    RETURNING id
  `;
  if (rows[0]) return ok({ id: rows[0].id as string });

  const batch = await get(params.id);
  if (!batch) return fail(err.notFound("Notification batch not found"));
  return fail(err.conflict("Only draft notification batches can be deleted"));
};

export const start = async (): Promise<void> => {
  // Jobs are submitted manually. This hook keeps service startup symmetrical
  // with other background services and gives future schedulers a stable home.
};

export const stop = async (): Promise<void> => {};

export const notificationBatches = {
  createDraft,
  preview,
  get,
  list,
  listRecipients,
  finalize,
  retryFailed,
  retryRecipient,
  removeDraft,
  start,
  stop,
};

export const __notificationBatchTest = {
  normalizeSelection,
  selectionHash,
  recipientHash,
  resolveCandidates,
};
