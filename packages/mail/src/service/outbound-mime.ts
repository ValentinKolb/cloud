import { markdown, sanitizeEmailHtml } from "@valentinkolb/cloud/shared";
import MailComposer from "nodemailer/lib/mail-composer";
import type { Readable } from "node:stream";
import { z } from "zod";
import { mailAddressSchema } from "../contracts";

const outboundDraftSnapshotBaseSchema = z.object({
  revision: z.number().int().positive(),
  from: z.object({ name: z.string().max(200), address: z.string().email().max(320) }),
  replyTo: z.string().email().max(320).nullable(),
  envelopeFrom: z.string().email().max(320).nullable(),
  useNullEnvelopeSender: z.boolean().default(false),
  automaticReply: z.boolean().default(false),
  to: z.array(mailAddressSchema).max(200),
  cc: z.array(mailAddressSchema).max(200),
  bcc: z.array(mailAddressSchema).max(200),
  subject: z.string().max(998),
  body: z.string().max(2 * 1024 * 1024),
  inReplyTo: z.string().max(998).nullable().default(null),
  references: z.array(z.string().max(998)).max(500).default([]),
  attachments: z
    .array(
      z.object({
        id: z.string().uuid(),
        blobId: z.string().uuid(),
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1).max(255),
        byteLength: z.number().int().nonnegative(),
        contentHash: z.string().length(64),
      }),
    )
    .max(200)
    .default([]),
});

export const outboundDraftSnapshotSchema = z.discriminatedUnion("format", [
  outboundDraftSnapshotBaseSchema.extend({
    format: z.literal("plain"),
    renderedText: z
      .string()
      .max(2 * 1024 * 1024)
      .optional(),
    renderedHtml: z.null().optional(),
  }),
  outboundDraftSnapshotBaseSchema.extend({
    format: z.literal("markdown"),
    renderedText: z
      .string()
      .max(2 * 1024 * 1024)
      .optional(),
    renderedHtml: z
      .string()
      .max(3 * 1024 * 1024)
      .nullable()
      .optional(),
  }),
]);

type OutboundDraftSnapshot = z.infer<typeof outboundDraftSnapshotSchema>;

const formatAddress = (address: { name?: string | null; address: string }) => ({
  name: address.name?.trim() ?? "",
  address: address.address,
});

export const buildMimeStream = (params: {
  snapshot: OutboundDraftSnapshot;
  messageId: string;
  date: Date;
  openAttachment: (blobId: string) => Readable;
}): Readable => {
  const html =
    params.snapshot.format === "plain"
      ? undefined
      : params.snapshot.renderedHtml === undefined
        ? sanitizeEmailHtml(markdown.renderSync(params.snapshot.body))
        : (params.snapshot.renderedHtml ?? undefined);
  return new MailComposer({
    from: formatAddress(params.snapshot.from),
    replyTo: params.snapshot.replyTo ?? undefined,
    to: params.snapshot.to.map(formatAddress),
    cc: params.snapshot.cc.map(formatAddress),
    bcc: params.snapshot.bcc.map(formatAddress),
    subject: params.snapshot.subject,
    text: params.snapshot.renderedText ?? params.snapshot.body,
    html,
    messageId: params.messageId,
    date: params.date,
    inReplyTo: params.snapshot.inReplyTo ?? undefined,
    references: params.snapshot.references,
    headers: params.snapshot.automaticReply ? { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" } : undefined,
    attachments: params.snapshot.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      content: params.openAttachment(attachment.blobId),
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  })
    .compile()
    .createReadStream();
};

export const buildMimeSource = async (params: {
  snapshot: OutboundDraftSnapshot;
  messageId: string;
  date: Date;
  openAttachment?: (blobId: string) => Readable;
}): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const value of buildMimeStream({
    ...params,
    openAttachment:
      params.openAttachment ??
      (() => {
        throw new Error("Attachment source is required");
      }),
  })) {
    chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array));
  }
  return Buffer.concat(chunks);
};

export const outboundRecipients = (snapshot: OutboundDraftSnapshot): string[] =>
  [...snapshot.to, ...snapshot.cc, ...snapshot.bcc].map((recipient) => recipient.address.toLowerCase());
