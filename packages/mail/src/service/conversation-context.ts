import { toPgTextArray } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { z } from "zod";
import {
  type MailConversationContext,
  type MailConversationContextQuery,
  mailConversationParticipantSchema,
  type RelatedMailPage,
} from "../contracts";
import { type AppIntegrationRequest, resolveContacts } from "./app-integrations";
import type { MailRequestContext } from "./auth";
import { requireMailboxCollaborationPermission } from "./collaboration";

type SqlClient = typeof sql;

type ConversationParticipant = {
  email: string;
  displayName: string | null;
};

type ConversationProjection = {
  participants: ConversationParticipant[];
};

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
  const [row] = await db<Array<{ participants: unknown }>>`
    SELECT COALESCE(participants.items, '[]'::jsonb) AS participants
    FROM mail.conversations conversation
    LEFT JOIN LATERAL (
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT('email', participant.email, 'displayName', participant.display_name)
        ORDER BY participant.last_seen_at DESC, participant.email
      ) AS items
      FROM (
        SELECT deduplicated.email, deduplicated.display_name, deduplicated.last_seen_at
        FROM (
          SELECT DISTINCT ON (address.normalized_email)
            address.normalized_email AS email,
            NULLIF(BTRIM(address.display_name), '') AS display_name,
            message.internal_date AS last_seen_at
          FROM mail.conversation_messages link
          JOIN mail.message_contents message ON message.id = link.message_id
          JOIN mail.message_addresses address ON address.message_id = link.message_id
          WHERE link.conversation_id = conversation.id
            AND address.role IN ('from', 'reply_to', 'to', 'cc', 'bcc')
            AND EXISTS (
              SELECT 1 FROM mail.message_placements placement
              WHERE placement.message_id = link.message_id AND placement.deleted_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1
              FROM mail.sender_identities identity
              WHERE identity.mailbox_id = conversation.mailbox_id
                AND address.normalized_email IN (
                  LOWER(BTRIM(identity.from_address)),
                  LOWER(BTRIM(COALESCE(identity.reply_to, '')))
                )
            )
          ORDER BY
            address.normalized_email,
            (NULLIF(BTRIM(address.display_name), '') IS NOT NULL) DESC,
            message.internal_date DESC,
            link.position DESC,
            address.role,
            address.position
        ) deduplicated
        ORDER BY deduplicated.last_seen_at DESC, deduplicated.email
        LIMIT 100
      ) participant
    ) participants ON true
    WHERE conversation.id = ${conversationId}::uuid AND conversation.mailbox_id = ${mailboxId}::uuid
  `;
  if (!row) return null;
  return {
    participants: z.array(mailConversationParticipantSchema).max(100).parse(row.participants),
  };
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
  const participantEmails = conversation.participants.map((participant) => participant.email);
  const contacts =
    participantEmails.length === 0
      ? { ok: true as const, data: { items: [], matchedEmails: [], nextCursor: null } }
      : await resolveContacts(
          {
            emails: participantEmails,
            cursor: params.query.contactsCursor,
            limit: params.query.contactsLimit,
          },
          params.request,
        );

  return ok({
    conversationId: params.conversationId,
    participants: conversation.participants,
    contacts: contacts.ok
      ? {
          status: "ready",
          items: contacts.data.items,
          matchedEmails: contacts.data.matchedEmails,
          nextCursor: contacts.data.nextCursor,
        }
      : { status: "unavailable", items: [], matchedEmails: [], nextCursor: null },
  });
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
  const participantEmails = conversation.participants.map((participant) => participant.email);
  if (participantEmails.length === 0) return fail(err.notFound("Contact"));
  const contact = await resolveContacts({ emails: participantEmails, contactIds: [params.contactId], limit: 1 }, params.request);
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
