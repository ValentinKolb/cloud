import { hasPermission } from "@valentinkolb/cloud/server";
import { toPgTextArray } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { z } from "zod";
import type {
  LinkConversationSpaceInput,
  MailConversationContext,
  MailConversationContextQuery,
  RelatedMailPage,
  UnlinkConversationSpaceInput,
} from "../contracts";
import { type AppIntegrationRequest, listSpaceCandidates, resolveContacts, resolveSpaces } from "./app-integrations";
import { actorRefFromRequest, type MailRequestContext } from "./auth";
import { lockMailboxForCollaboration, requireMailboxCollaborationPermission } from "./collaboration";
import { publishMailCollaborationEvent } from "./events";

type SqlClient = typeof sql;

type ConversationProjection = {
  revision: number;
  participantEmails: string[];
};

type SpaceLinkRow = { id: string; space_id: string };
type HistoryCursor = { version: 1; date: string; id: string };

const historyCursorSchema = z.object({ version: z.literal(1), date: z.string().datetime(), id: z.uuid() }).strict();

const encodeHistoryCursor = (cursor: HistoryCursor): string => Buffer.from(JSON.stringify(cursor)).toString("base64url");

const decodeHistoryCursor = (value?: string): Result<HistoryCursor | null> => {
  if (!value) return ok(null);
  try {
    const parsed = historyCursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? ok(parsed.data) : fail(err.badInput("Invalid related Mail cursor"));
  } catch {
    return fail(err.badInput("Invalid related Mail cursor"));
  }
};

const loadConversationProjection = async (
  mailboxId: string,
  conversationId: string,
  db: SqlClient = sql,
): Promise<ConversationProjection | null> => {
  const [row] = await db<{ revision: string | number; participant_emails: string[] }[]>`
    SELECT
      conversation.revision,
      ARRAY(
        SELECT DISTINCT address.normalized_email
        FROM mail.conversation_messages link
        JOIN mail.message_addresses address ON address.message_id = link.message_id
        WHERE link.conversation_id = conversation.id
          AND address.role IN ('from', 'reply_to', 'to', 'cc', 'bcc')
          AND EXISTS (
            SELECT 1 FROM mail.message_placements placement
            WHERE placement.message_id = link.message_id AND placement.deleted_at IS NULL
          )
        ORDER BY address.normalized_email
        LIMIT 100
      ) AS participant_emails
    FROM mail.conversations conversation
    WHERE conversation.id = ${conversationId}::uuid
      AND conversation.mailbox_id = ${mailboxId}::uuid
  `;
  return row ? { revision: Number(row.revision), participantEmails: row.participant_emails } : null;
};

const listSpaceLinks = (conversationId: string, db: SqlClient = sql): Promise<SpaceLinkRow[]> =>
  db<SpaceLinkRow[]>`
    SELECT id, space_id
    FROM mail.conversation_space_links
    WHERE conversation_id = ${conversationId}::uuid
    ORDER BY created_at, id
    LIMIT 20
  `;

export const projectSpaceLinks = (params: {
  links: SpaceLinkRow[];
  resolved: Array<{ id: string; name: string; color: string | null; href: string; updatedAt: string }>;
  canWrite: boolean;
  available: boolean;
}): MailConversationContext["spaces"] => {
  const spaces = new Map(params.resolved.map((space) => [space.id, space]));
  const links = params.links
    .map((link) => ({ linkId: link.id, space: spaces.get(link.space_id) ?? null }))
    .filter((link) => link.space !== null || params.canWrite);
  return params.available
    ? { status: "ready", links }
    : { status: "unavailable", links: params.canWrite ? links.map((link) => ({ linkId: link.linkId, space: null })) : [] };
};

export const getConversationContext = async (params: {
  context: MailRequestContext;
  request: AppIntegrationRequest;
  mailboxId: string;
  conversationId: string;
  query: MailConversationContextQuery;
}): Promise<Result<MailConversationContext>> => {
  const access = await requireMailboxCollaborationPermission(params.context, params.mailboxId, "read");
  if (!access.ok) return access;
  const conversation = await loadConversationProjection(params.mailboxId, params.conversationId);
  if (!conversation) return fail(err.notFound("Conversation"));
  const includeContacts = params.query.section !== "spaces";
  const includeSpaces = params.query.section !== "contacts";
  const links = includeSpaces ? await listSpaceLinks(params.conversationId) : [];
  const canWrite = hasPermission(access.data, "write");

  const [contacts, spaces] = await Promise.all([
    !includeContacts || conversation.participantEmails.length === 0
      ? Promise.resolve({ ok: true as const, data: { items: [], nextCursor: null } })
      : resolveContacts(
          {
            emails: conversation.participantEmails,
            cursor: params.query.contactsCursor,
            limit: params.query.contactsLimit,
          },
          params.request,
        ),
    !includeSpaces || links.length === 0
      ? Promise.resolve({ ok: true as const, data: { items: [] } })
      : resolveSpaces(
          links.map((link) => link.space_id),
          params.request,
        ),
  ]);

  return ok({
    conversationId: params.conversationId,
    conversationRevision: conversation.revision,
    canWrite,
    contacts: contacts.ok
      ? { status: "ready", items: contacts.data.items, nextCursor: contacts.data.nextCursor }
      : { status: "unavailable", items: [], nextCursor: null },
    spaces: projectSpaceLinks({
      links,
      resolved: spaces.ok ? spaces.data.items : [],
      canWrite,
      available: spaces.ok,
    }),
  });
};

export const listCandidates = async (params: {
  context: MailRequestContext;
  request: AppIntegrationRequest;
  mailboxId: string;
  conversationId: string;
  query: { q?: string; cursor?: string; limit: number };
}) => {
  const access = await requireMailboxCollaborationPermission(params.context, params.mailboxId, "write");
  if (!access.ok) return access;
  if (!(await loadConversationProjection(params.mailboxId, params.conversationId))) return fail(err.notFound("Conversation"));
  const result = await listSpaceCandidates(params.query, params.request);
  if (!result.ok) return fail(err.internal("Spaces are temporarily unavailable"));
  const linked = new Set((await listSpaceLinks(params.conversationId)).map((link) => link.space_id));
  return ok({ ...result.data, items: result.data.items.filter((space) => !linked.has(space.id)) });
};

const actorIdentity = (context: MailRequestContext): { kind: "user" | "service_account"; id: string } => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: "user", id: actor.userId };
  if (actor.kind === "service_account") return { kind: "service_account", id: actor.serviceAccountId };
  throw new Error("Request actor cannot change conversation Space links");
};

export const linkSpace = async (params: {
  context: MailRequestContext;
  request: AppIntegrationRequest;
  mailboxId: string;
  conversationId: string;
  input: LinkConversationSpaceInput;
}): Promise<Result<{ linkId: string; conversationRevision: number }>> => {
  const access = await requireMailboxCollaborationPermission(params.context, params.mailboxId, "write");
  if (!access.ok) return access;
  const target = await resolveSpaces([params.input.spaceId], params.request);
  if (!target.ok || !target.data.items.some((space) => space.id === params.input.spaceId)) {
    return fail(err.notFound("Space"));
  }
  const actor = actorIdentity(params.context);
  const mutation = await sql.begin(async (tx) => {
    const access = await lockMailboxForCollaboration(params.context, params.mailboxId, "write", tx);
    if (!access.ok) return access;
    const [conversation] = await tx<{ revision: string | number }[]>`
      SELECT revision FROM mail.conversations
      WHERE id = ${params.conversationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      FOR UPDATE
    `;
    if (!conversation) return fail(err.notFound("Conversation"));
    if (Number(conversation.revision) !== params.input.expectedRevision) return fail(err.conflict("Conversation revision"));
    const [count] = await tx<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM mail.conversation_space_links
      WHERE conversation_id = ${params.conversationId}::uuid
    `;
    if ((count?.count ?? 0) >= 20) return fail(err.badInput("A conversation can link at most 20 Spaces"));
    const [link] = await tx<{ id: string }[]>`
      INSERT INTO mail.conversation_space_links (
        mailbox_id, conversation_id, space_id, created_by_actor_kind, created_by_actor_id
      ) VALUES (
        ${params.mailboxId}::uuid, ${params.conversationId}::uuid, ${params.input.spaceId}::uuid, ${actor.kind}, ${actor.id}::uuid
      )
      ON CONFLICT (conversation_id, space_id) DO NOTHING
      RETURNING id
    `;
    if (!link) return fail(err.conflict("Space link"));
    const [updated] = await tx<{ revision: string | number }[]>`
      UPDATE mail.conversations SET revision = revision + 1, updated_at = now()
      WHERE id = ${params.conversationId}::uuid
      RETURNING revision
    `;
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO mail.activity_events (
        mailbox_id, conversation_id, actor_kind, actor_id, action, outcome, target_type, target_id
      ) VALUES (
        ${params.mailboxId}::uuid, ${params.conversationId}::uuid, ${actor.kind}, ${actor.id}::uuid,
        'conversation.space_linked', 'confirmed', 'conversation_space_link', ${link.id}::uuid
      )
      RETURNING id::text AS id
    `;
    return ok({ linkId: link.id, conversationRevision: Number(updated!.revision), activityId: activity!.id });
  });
  if (!mutation.ok) return mutation;
  await publishMailCollaborationEvent({
    mailboxId: params.mailboxId,
    conversationId: params.conversationId,
    reason: "space_link",
    targetId: mutation.data.linkId,
    activityId: mutation.data.activityId,
  });
  return ok({ linkId: mutation.data.linkId, conversationRevision: mutation.data.conversationRevision });
};

export const unlinkSpace = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  linkId: string;
  input: UnlinkConversationSpaceInput;
}): Promise<Result<{ linkId: string; conversationRevision: number }>> => {
  const actor = actorIdentity(params.context);
  const mutation = await sql.begin(async (tx) => {
    const access = await lockMailboxForCollaboration(params.context, params.mailboxId, "write", tx);
    if (!access.ok) return access;
    const [conversation] = await tx<{ revision: string | number }[]>`
      SELECT revision FROM mail.conversations
      WHERE id = ${params.conversationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      FOR UPDATE
    `;
    if (!conversation) return fail(err.notFound("Conversation"));
    if (Number(conversation.revision) !== params.input.expectedRevision) return fail(err.conflict("Conversation revision"));
    const removed = await tx`
      DELETE FROM mail.conversation_space_links
      WHERE id = ${params.linkId}::uuid
        AND conversation_id = ${params.conversationId}::uuid
        AND mailbox_id = ${params.mailboxId}::uuid
    `;
    if (removed.count === 0) return fail(err.notFound("Space link"));
    const [updated] = await tx<{ revision: string | number }[]>`
      UPDATE mail.conversations SET revision = revision + 1, updated_at = now()
      WHERE id = ${params.conversationId}::uuid
      RETURNING revision
    `;
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO mail.activity_events (
        mailbox_id, conversation_id, actor_kind, actor_id, action, outcome, target_type, target_id
      ) VALUES (
        ${params.mailboxId}::uuid, ${params.conversationId}::uuid, ${actor.kind}, ${actor.id}::uuid,
        'conversation.space_unlinked', 'confirmed', 'conversation_space_link', ${params.linkId}::uuid
      )
      RETURNING id::text AS id
    `;
    return ok({ linkId: params.linkId, conversationRevision: Number(updated!.revision), activityId: activity!.id });
  });
  if (!mutation.ok) return mutation;
  await publishMailCollaborationEvent({
    mailboxId: params.mailboxId,
    conversationId: params.conversationId,
    reason: "space_link",
    targetId: params.linkId,
    activityId: mutation.data.activityId,
  });
  return ok({ linkId: params.linkId, conversationRevision: mutation.data.conversationRevision });
};

export const listRelatedMail = async (params: {
  context: MailRequestContext;
  request: AppIntegrationRequest;
  mailboxId: string;
  conversationId: string;
  bookId: string;
  contactId: string;
  cursor?: string;
  limit: number;
}): Promise<Result<RelatedMailPage>> => {
  const access = await requireMailboxCollaborationPermission(params.context, params.mailboxId, "read");
  if (!access.ok) return access;
  const conversation = await loadConversationProjection(params.mailboxId, params.conversationId);
  if (!conversation) return fail(err.notFound("Conversation"));
  if (conversation.participantEmails.length === 0) return fail(err.notFound("Contact"));
  const contact = await resolveContacts(
    { emails: conversation.participantEmails, contactIds: [params.contactId], limit: 1 },
    params.request,
  );
  if (!contact.ok) return fail(err.internal("Contacts are temporarily unavailable"));
  const match = contact.data.items.find((item) => item.contactId === params.contactId && item.bookId === params.bookId);
  if (!match) return fail(err.notFound("Contact"));
  const cursor = decodeHistoryCursor(params.cursor);
  if (!cursor.ok) return cursor;
  const limit = Math.min(Math.max(params.limit, 1), 25);
  const rows = await sql<
    Array<{ id: string; subject: string; participant_summary: string; latest_message_at: Date; preview: string | null }>
  >`
    WITH address_matches AS MATERIALIZED (
      SELECT DISTINCT link.conversation_id
      FROM mail.message_addresses address
      JOIN mail.conversation_messages link ON link.message_id = address.message_id
      JOIN mail.message_contents message ON message.id = address.message_id
      WHERE address.normalized_email = ANY(${toPgTextArray(match.matchedEmails)}::text[])
        AND message.mailbox_id = ${params.mailboxId}::uuid
        AND EXISTS (
          SELECT 1 FROM mail.message_placements placement
          WHERE placement.message_id = message.id AND placement.deleted_at IS NULL
        )
    )
    SELECT
      conversation.id,
      conversation.subject,
      conversation.participant_summary,
      conversation.latest_message_at,
      latest.preview
    FROM address_matches match
    JOIN mail.conversations conversation ON conversation.id = match.conversation_id
    LEFT JOIN LATERAL (
      SELECT NULLIF(LEFT(BTRIM(COALESCE(message.plain_text, '')), 240), '') AS preview
      FROM mail.conversation_messages link
      JOIN mail.message_contents message ON message.id = link.message_id
      WHERE link.conversation_id = conversation.id
      ORDER BY message.internal_date DESC, message.id DESC
      LIMIT 1
    ) latest ON true
    WHERE conversation.mailbox_id = ${params.mailboxId}::uuid
      AND conversation.id <> ${params.conversationId}::uuid
      AND (${cursor.data?.id ?? null}::uuid IS NULL OR (conversation.latest_message_at, conversation.id) < (${cursor.data?.date ?? null}::timestamptz, ${cursor.data?.id ?? null}::uuid))
    ORDER BY conversation.latest_message_at DESC, conversation.id DESC
    LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map((row) => ({
    id: row.id,
    subject: row.subject,
    participantSummary: row.participant_summary,
    latestMessageAt: row.latest_message_at.toISOString(),
    preview: row.preview,
  }));
  const last = items.at(-1);
  return ok({
    items,
    nextCursor: hasMore && last ? encodeHistoryCursor({ version: 1, date: last.latestMessageAt, id: last.id }) : null,
  });
};
