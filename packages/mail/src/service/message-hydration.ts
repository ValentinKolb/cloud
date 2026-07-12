import { randomUUID } from "node:crypto";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sql } from "bun";
import { type AttachmentStream, type Headers, MailParser, type MessageText } from "mailparser";
import sanitizeHtml from "sanitize-html";
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

export const hydrateMessageFromSource = async (params: {
  messageId: string;
  source: Readable;
  expectedSize?: number | null;
  claimId?: string;
}): Promise<{ status: "hydrated" | "already_complete"; sourceHash?: string }> => {
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
    });
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
