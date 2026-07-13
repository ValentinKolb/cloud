import { randomUUID } from "node:crypto";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sql } from "bun";
import { type AttachmentStream, type Headers, MailParser, type MessageText } from "mailparser";
import sanitizeHtml from "sanitize-html";
import { type MailCollaborationEvent, publishMailCollaborationEvent } from "./events";
import { type StoredBlob, storeReadableBlob } from "./message-blobs";
import { splitSearchText } from "./search-chunks";

type HydratedPart = {
  partPath: string;
  contentType: string;
  charset: string | null;
  transferEncoding: string | null;
  disposition: string | null;
  contentId: string | null;
  filename: string | null;
  blob: StoredBlob;
  attachment: boolean;
};

type ClaimedMessage = {
  id: string;
  mime_structure: Record<string, unknown> | string;
};

type MessageIdentityProjection = {
  id: string;
  conversation_id: string | null;
  override_conversation_id: string | null;
};

type VerifiedConversationProjection = {
  conversation_id: string;
  mailbox_id: string;
  work_status: "open" | "waiting" | "done";
  response_needed: boolean;
  snoozed_until: Date | string | null;
  outbound: boolean;
  is_latest_verified: boolean;
  message_count: number;
};

type VerifiedDuplicateResult = {
  canonicalMessageId: string | null;
  duplicateFound: boolean;
};

const incomingAllowedTags = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
] as const;

export const sanitizeIncomingMailHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: [...incomingAllowedTags],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      table: ["cellpadding", "cellspacing", "width", "align", "border"],
      td: ["width", "align", "valign", "colspan", "rowspan"],
      th: ["width", "align", "valign", "colspan", "rowspan"],
      tr: ["align", "valign"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["cid"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
      }),
    },
  });

const jsonValue = (value: unknown, depth = 0): unknown => {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => jsonValue(item, depth + 1));
  if (value instanceof Map)
    return Object.fromEntries([...value.entries()].map(([key, child]) => [String(key), jsonValue(child, depth + 1)]));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 200)
        .map(([key, child]) => [key, jsonValue(child, depth + 1)]),
    );
  }
  return String(value);
};

const selectedHeaders = (headers: Headers | null): Record<string, unknown> => {
  if (!headers) return {};
  const names = ["message-id", "in-reply-to", "references", "date", "from", "reply-to", "to", "cc", "bcc", "subject", "content-type"];
  return Object.fromEntries(names.flatMap((name) => (headers.has(name) ? [[name, jsonValue(headers.get(name))]] : [])));
};

const findPartPath = (structure: Record<string, unknown>, contentType: string): string | null => {
  if (typeof structure["type"] === "string" && structure["type"].toLowerCase() === contentType) {
    return typeof structure["part"] === "string" ? structure["part"] : null;
  }
  const children = Array.isArray(structure["childNodes"]) ? structure["childNodes"] : [];
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    const found = findPartPath(child as Record<string, unknown>, contentType);
    if (found) return found;
  }
  return null;
};

const normalizeErrorCode = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code) ? code : "MIME_HYDRATION_FAILED";
};

const readableFromText = (value: string): Readable => Readable.from([Buffer.from(value, "utf8")]);

const claimMessage = async (messageId: string, claimId: string): Promise<ClaimedMessage | "complete" | null> => {
  const [claimed] = await sql<ClaimedMessage[]>`
    UPDATE mail.message_contents
    SET
      hydration_status = 'hydrating',
      hydration_attempt = hydration_attempt + 1,
      hydration_claim_id = ${claimId}::uuid,
      hydration_claimed_at = now(),
      hydration_error_code = NULL
    WHERE id = ${messageId}::uuid
      AND hydration_status <> 'complete'
      AND hydration_attempt < 5
      AND (
        hydration_status <> 'hydrating'
        OR hydration_claimed_at < now() - interval '15 minutes'
      )
    RETURNING id, mime_structure
  `;
  if (claimed) return claimed;
  const [current] = await sql<{ hydration_status: string }[]>`
    SELECT hydration_status FROM mail.message_contents WHERE id = ${messageId}::uuid
  `;
  if (!current) return null;
  return current.hydration_status === "complete" ? "complete" : null;
};

const mergeVerifiedDuplicate = async (params: {
  db: typeof sql;
  messageId: string;
  sourceHash: string;
}): Promise<VerifiedDuplicateResult> => {
  await params.db`
    SELECT pg_advisory_xact_lock(hashtextextended(message.mailbox_id::text || ':' || ${params.sourceHash}, 0))
    FROM mail.message_contents message
    WHERE message.id = ${params.messageId}::uuid
  `;
  const canonicalIdentities = await params.db<{ id: string }[]>`
    SELECT candidate.id
    FROM mail.message_contents current_message
    JOIN mail.message_contents candidate
      ON candidate.mailbox_id = current_message.mailbox_id
     AND candidate.id <> current_message.id
     AND candidate.source_hash = ${params.sourceHash}
     AND candidate.hydration_status = 'complete'
    WHERE current_message.id = ${params.messageId}::uuid
    ORDER BY EXISTS (
      SELECT 1 FROM mail.conversation_thread_overrides thread_override WHERE thread_override.message_id = candidate.id
    ) DESC, candidate.created_at, candidate.id
    FOR UPDATE OF candidate
  `;
  if (canonicalIdentities.length === 0) return { canonicalMessageId: null, duplicateFound: false };
  const identityIds = [params.messageId, ...canonicalIdentities.map((candidate) => candidate.id)].sort();
  await params.db`
    SELECT message_id
    FROM mail.conversation_messages
    WHERE message_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${identityIds}::jsonb))
    ORDER BY message_id
    FOR UPDATE
  `;
  await params.db`
    SELECT message_id
    FROM mail.conversation_thread_overrides
    WHERE message_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${identityIds}::jsonb))
    ORDER BY message_id
    FOR UPDATE
  `;
  const projections = await params.db<MessageIdentityProjection[]>`
    SELECT
      message.id,
      link.conversation_id,
      thread_override.conversation_id AS override_conversation_id
    FROM mail.message_contents message
    LEFT JOIN mail.conversation_messages link ON link.message_id = message.id
    LEFT JOIN mail.conversation_thread_overrides thread_override ON thread_override.message_id = message.id
    WHERE message.id IN (SELECT value::uuid FROM jsonb_array_elements_text(${identityIds}::jsonb))
  `;
  const current = projections.find((projection) => projection.id === params.messageId);
  if (!current) return { canonicalMessageId: null, duplicateFound: true };

  const currentConversationId = current.override_conversation_id ?? current.conversation_id;
  const canonical = canonicalIdentities
    .map((candidate) => projections.find((projection) => projection.id === candidate.id))
    .find((candidate) => {
      if (!candidate) return false;
      const candidateConversationId = candidate.override_conversation_id ?? candidate.conversation_id;
      return !currentConversationId || !candidateConversationId || currentConversationId === candidateConversationId;
    });
  if (!canonical) return { canonicalMessageId: null, duplicateFound: true };

  if (current.override_conversation_id && !canonical.override_conversation_id) {
    await params.db`
      INSERT INTO mail.conversation_thread_overrides (
        message_id, mailbox_id, conversation_id, reason, actor_kind, actor_id, revision, created_at, updated_at
      )
      SELECT
        ${canonical.id}::uuid,
        mailbox_id,
        conversation_id,
        reason,
        actor_kind,
        actor_id,
        revision,
        created_at,
        updated_at
      FROM mail.conversation_thread_overrides
      WHERE message_id = ${params.messageId}::uuid
      ON CONFLICT (message_id) DO NOTHING
    `;
  }
  if (current.conversation_id && !canonical.conversation_id) {
    await params.db`
      INSERT INTO mail.conversation_messages (conversation_id, message_id, position, added_by, created_at)
      SELECT conversation_id, ${canonical.id}::uuid, position, added_by, created_at
      FROM mail.conversation_messages
      WHERE message_id = ${params.messageId}::uuid
      ON CONFLICT DO NOTHING
    `;
  }
  await params.db`
    UPDATE mail.conversation_comments
    SET referenced_message_id = ${canonical.id}::uuid
    WHERE referenced_message_id = ${params.messageId}::uuid
  `;
  await params.db`
    UPDATE mail.message_placements
    SET message_id = ${canonical.id}::uuid, updated_at = now()
    WHERE message_id = ${params.messageId}::uuid
  `;
  await params.db`
    UPDATE mail.remote_message_refs
    SET message_id = ${canonical.id}::uuid
    WHERE message_id = ${params.messageId}::uuid
  `;
  await params.db`DELETE FROM mail.message_contents WHERE id = ${params.messageId}::uuid`;
  return { canonicalMessageId: canonical.id, duplicateFound: true };
};

const applyVerifiedConversationTransition = async (params: {
  db: typeof sql;
  messageId: string;
}): Promise<Omit<MailCollaborationEvent, "type" | "at"> | null> => {
  const [lockedConversation] = await params.db<{ id: string }[]>`
    SELECT conversation.id
    FROM mail.message_contents message
    JOIN mail.conversation_messages link ON link.message_id = message.id
    JOIN mail.conversations conversation ON conversation.id = link.conversation_id
    WHERE message.id = ${params.messageId}::uuid
    FOR UPDATE OF conversation
  `;
  if (!lockedConversation) return null;

  const [projection] = await params.db<VerifiedConversationProjection[]>`
    SELECT
      conversation.id AS conversation_id,
      conversation.mailbox_id,
      conversation.work_status,
      conversation.response_needed,
      conversation.snoozed_until,
      EXISTS (
        SELECT 1
        FROM mail.message_addresses sender
        JOIN mail.sender_identities identity
          ON identity.mailbox_id = conversation.mailbox_id
         AND identity.status <> 'disabled'
         AND lower(identity.from_address) = sender.normalized_email
        WHERE sender.message_id = message.id AND sender.role = 'from'
      ) AS outbound,
      NOT EXISTS (
        SELECT 1
        FROM mail.conversation_messages newer_link
        JOIN mail.message_contents newer_message ON newer_message.id = newer_link.message_id
        WHERE newer_link.conversation_id = conversation.id
          AND newer_message.hydration_status = 'complete'
          AND (newer_message.internal_date, newer_message.id) > (message.internal_date, message.id)
      ) AS is_latest_verified,
      (
        SELECT COUNT(*)::int
        FROM mail.conversation_messages conversation_link
        WHERE conversation_link.conversation_id = conversation.id
      ) AS message_count
    FROM mail.message_contents message
    JOIN mail.conversation_messages link ON link.message_id = message.id
    JOIN mail.conversations conversation ON conversation.id = link.conversation_id
    WHERE message.id = ${params.messageId}::uuid
  `;
  if (!projection) return null;

  const nextWorkStatus = projection.is_latest_verified && !projection.outbound ? "open" : projection.work_status;
  const nextResponseNeeded = projection.is_latest_verified ? !projection.outbound : projection.response_needed;
  const nextSnoozedUntil = projection.is_latest_verified && !projection.outbound ? null : projection.snoozed_until;
  const changed =
    projection.work_status !== nextWorkStatus ||
    projection.response_needed !== nextResponseNeeded ||
    (projection.snoozed_until ? new Date(projection.snoozed_until).toISOString() : null) !==
      (nextSnoozedUntil ? new Date(nextSnoozedUntil).toISOString() : null);
  await params.db`
    WITH classified AS (
      SELECT
        message.id AS message_id,
        message.subject,
        message.internal_date,
        EXISTS (
          SELECT 1
          FROM mail.message_addresses sender
          JOIN mail.sender_identities identity
            ON identity.mailbox_id = conversation.mailbox_id
           AND identity.status <> 'disabled'
           AND lower(identity.from_address) = sender.normalized_email
          WHERE sender.message_id = message.id AND sender.role = 'from'
        ) AS outbound
      FROM mail.conversations conversation
      JOIN mail.conversation_messages link ON link.conversation_id = conversation.id
      JOIN mail.message_contents message ON message.id = link.message_id
      WHERE conversation.id = ${projection.conversation_id}::uuid
        AND message.hydration_status = 'complete'
    ),
    timeline AS (
      SELECT
        MAX(internal_date) AS latest_message_at,
        MAX(internal_date) FILTER (WHERE NOT outbound) AS latest_inbound_at,
        MAX(internal_date) FILTER (WHERE outbound) AS latest_outbound_at
      FROM classified
    ),
    latest AS (
      SELECT message_id, subject
      FROM classified
      ORDER BY internal_date DESC, message_id DESC
      LIMIT 1
    ),
    participant_labels AS (
      SELECT DISTINCT ON (address.normalized_email)
        address.normalized_email,
        COALESCE(NULLIF(address.display_name, ''), address.email) AS label
      FROM mail.message_addresses address
      JOIN latest ON latest.message_id = address.message_id
      ORDER BY address.normalized_email, address.position
    ),
    participants AS (
      SELECT COALESCE(string_agg(label, ', ' ORDER BY label), '') AS summary
      FROM participant_labels
    )
    UPDATE mail.conversations conversation
    SET
      subject = latest.subject,
      participant_summary = participants.summary,
      latest_message_at = timeline.latest_message_at,
      latest_inbound_at = timeline.latest_inbound_at,
      latest_outbound_at = timeline.latest_outbound_at,
      work_status = ${nextWorkStatus},
      response_needed = ${nextResponseNeeded},
      snoozed_until = ${nextSnoozedUntil},
      revision = conversation.revision + CASE WHEN ${projection.message_count > 1 || changed} THEN 1 ELSE 0 END
    FROM timeline, latest, participants
    WHERE conversation.id = ${projection.conversation_id}::uuid
  `;
  if (!changed || projection.outbound || !projection.is_latest_verified) return null;

  const [activity] = await params.db<{ id: string | number }[]>`
    INSERT INTO mail.activity_events (
      mailbox_id, conversation_id, actor_kind, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${projection.mailbox_id}::uuid,
      ${projection.conversation_id}::uuid,
      'system',
      'conversation.reopened',
      'reconciled',
      'conversation',
      ${projection.conversation_id}::uuid,
      ${{
        messageId: params.messageId,
        before: {
          workStatus: projection.work_status,
          responseNeeded: projection.response_needed,
          snoozedUntil: projection.snoozed_until ? new Date(projection.snoozed_until).toISOString() : null,
        },
        after: { workStatus: "open", responseNeeded: true, snoozedUntil: null },
      }}::jsonb
    )
    RETURNING id
  `;
  if (!activity) throw new Error("Conversation reopen activity insert returned no row");
  return {
    mailboxId: projection.mailbox_id,
    conversationId: projection.conversation_id,
    reason: "inbound",
    targetId: params.messageId,
    activityId: String(activity.id),
  };
};

export const hydrateMessageFromSource = async (params: {
  messageId: string;
  source: Readable;
  expectedSize?: number | null;
  claimId?: string;
}): Promise<{ status: "hydrated" | "already_complete" | "deduplicated"; sourceHash?: string; canonicalMessageId?: string }> => {
  const claimId = params.claimId ?? randomUUID();
  const claimed = await claimMessage(params.messageId, claimId);
  if (claimed === "complete") {
    params.source.destroy();
    return { status: "already_complete" };
  }
  if (!claimed) {
    params.source.destroy();
    throw Object.assign(new Error("Message hydration is already running or the message does not exist"), {
      code: "HYDRATION_NOT_CLAIMED",
    });
  }

  const mimeStructure =
    typeof claimed.mime_structure === "string" ? (JSON.parse(claimed.mime_structure) as Record<string, unknown>) : claimed.mime_structure;
  const sourceHasher = new Bun.CryptoHasher("sha256");
  let sourceBytes = 0;
  const hashingStream = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      sourceHasher.update(chunk);
      sourceBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const parser = new MailParser({
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
    keepCidLinks: true,
    maxHtmlLengthToParse: 10 * 1024 * 1024,
    checksumAlgo: "sha256",
  });
  let headers: Headers | null = null;
  parser.once("headers", (value) => {
    headers = value;
  });

  const parts: HydratedPart[] = [];
  let plainText = "";
  let originalHtml: string | null = null;
  let attachmentIndex = 0;
  const parsePipeline = pipeline(params.source, hashingStream, parser);

  try {
    for await (const value of parser as AsyncIterable<AttachmentStream | MessageText>) {
      if (value.type === "attachment") {
        const attachment = value as AttachmentStream & { partId?: string };
        attachmentIndex += 1;
        try {
          const blob = await storeReadableBlob(attachment.content as Readable, attachment.size || null);
          parts.push({
            partPath: attachment.partId || `attachment-${attachmentIndex}`,
            contentType: attachment.contentType || "application/octet-stream",
            charset: null,
            transferEncoding: null,
            disposition: attachment.contentDisposition || "attachment",
            contentId: attachment.contentId ?? null,
            filename: attachment.filename ?? null,
            blob,
            attachment: true,
          });
        } finally {
          attachment.release();
        }
      } else {
        plainText = value.text ?? "";
        originalHtml = typeof value.html === "string" ? value.html : null;
      }
    }
    await parsePipeline;
    if (params.expectedSize != null && params.expectedSize >= 0 && sourceBytes !== params.expectedSize) {
      throw Object.assign(new Error("Message source ended before the advertised byte count"), {
        code: "MESSAGE_SIZE_MISMATCH",
      });
    }

    if (plainText) {
      const blob = await storeReadableBlob(readableFromText(plainText), Buffer.byteLength(plainText));
      parts.push({
        partPath: findPartPath(mimeStructure, "text/plain") ?? "normalized-plain",
        contentType: "text/plain",
        charset: "utf-8",
        transferEncoding: null,
        disposition: "inline",
        contentId: null,
        filename: null,
        blob,
        attachment: false,
      });
    }
    if (originalHtml) {
      const blob = await storeReadableBlob(readableFromText(originalHtml), Buffer.byteLength(originalHtml));
      parts.push({
        partPath: findPartPath(mimeStructure, "text/html") ?? "original-html",
        contentType: "text/html",
        charset: "utf-8",
        transferEncoding: null,
        disposition: "inline",
        contentId: null,
        filename: null,
        blob,
        attachment: false,
      });
    }

    const sourceHash = sourceHasher.digest("hex");
    const sanitizedHtml = originalHtml ? sanitizeIncomingMailHtml(originalHtml) : null;
    let canonicalMessageId: string | null = null;
    let collaborationEvent: Omit<MailCollaborationEvent, "type" | "at"> | null = null;
    await sql.begin(async (tx) => {
      const [current] = await tx<{ id: string }[]>`
        SELECT id
        FROM mail.message_contents
        WHERE id = ${params.messageId}::uuid
          AND hydration_status = 'hydrating'
          AND hydration_claim_id = ${claimId}::uuid
        FOR UPDATE
      `;
      if (!current) throw Object.assign(new Error("Message hydration claim was lost"), { code: "HYDRATION_CLAIM_LOST" });
      const duplicate = await mergeVerifiedDuplicate({ db: tx, messageId: params.messageId, sourceHash });
      canonicalMessageId = duplicate.canonicalMessageId;
      if (canonicalMessageId) return;
      await tx`DELETE FROM mail.message_parts WHERE message_id = ${params.messageId}::uuid`;
      await tx`DELETE FROM mail.message_search_chunks WHERE message_id = ${params.messageId}::uuid`;
      for (const part of parts) {
        const [partRow] = await tx<{ id: string }[]>`
          INSERT INTO mail.message_parts (
            message_id,
            part_path,
            content_type,
            charset,
            transfer_encoding,
            disposition,
            content_id,
            filename,
            size_bytes,
            blob_id,
            hydration_status
          )
          VALUES (
            ${params.messageId}::uuid,
            ${part.partPath},
            ${part.contentType},
            ${part.charset},
            ${part.transferEncoding},
            ${part.disposition},
            ${part.contentId},
            ${part.filename},
            ${part.blob.byteLength},
            ${part.blob.id}::uuid,
            'complete'
          )
          RETURNING id
        `;
        if (!partRow) throw new Error("Message part insert returned no row");
        if (part.attachment) {
          await tx`
            INSERT INTO mail.attachments (
              message_id,
              part_id,
              filename,
              content_type,
              disposition,
              content_id,
              checksum,
              size_bytes,
              blob_id
            )
            VALUES (
              ${params.messageId}::uuid,
              ${partRow.id}::uuid,
              ${part.filename},
              ${part.contentType},
              ${part.disposition},
              ${part.contentId},
              ${part.blob.contentHash},
              ${part.blob.byteLength},
              ${part.blob.id}::uuid
            )
          `;
        }
      }
      const searchChunks = splitSearchText(plainText);
      for (let position = 0; position < searchChunks.length; position += 1) {
        await tx`
          INSERT INTO mail.message_search_chunks (message_id, position, search_document)
          VALUES (
            ${params.messageId}::uuid,
            ${position},
            to_tsvector('simple'::regconfig, ${searchChunks[position]!})
          )
        `;
      }
      await tx`
        UPDATE mail.message_contents
        SET
          plain_text = ${plainText || null},
          sanitized_html = ${sanitizedHtml},
          selected_headers = selected_headers || ${selectedHeaders(headers)}::jsonb,
          source_hash = ${sourceHash},
          hydration_status = 'complete',
          hydration_error_code = NULL,
          hydration_claim_id = NULL,
          hydration_claimed_at = NULL,
          hydrated_at = now()
        WHERE id = ${params.messageId}::uuid AND hydration_claim_id = ${claimId}::uuid
      `;
      if (!duplicate.duplicateFound) {
        collaborationEvent = await applyVerifiedConversationTransition({ db: tx, messageId: params.messageId });
      }
    });
    if (canonicalMessageId) return { status: "deduplicated", sourceHash, canonicalMessageId };
    if (collaborationEvent) await publishMailCollaborationEvent(collaborationEvent);
    return { status: "hydrated", sourceHash };
  } catch (error) {
    params.source.destroy();
    await parsePipeline.catch(() => undefined);
    await sql`
      UPDATE mail.message_contents
      SET
        hydration_status = 'failed',
        hydration_error_code = ${normalizeErrorCode(error)},
        hydration_claim_id = NULL,
        hydration_claimed_at = NULL
      WHERE id = ${params.messageId}::uuid AND hydration_claim_id = ${claimId}::uuid
    `.catch(() => undefined);
    throw error;
  }
};
