import { markdown, sanitizeEmailHtml } from "@valentinkolb/cloud/shared";
import MailComposer from "nodemailer/lib/mail-composer";
import type { Readable } from "node:stream";
import { z } from "zod";
import { mailAddressSchema } from "../contracts";

export const outboundDraftSnapshotSchema = z.object({
  revision: z.number().int().positive(),
  from: z.object({ name: z.string().max(200), address: z.string().email().max(320) }),
  replyTo: z.string().email().max(320).nullable(),
  envelopeFrom: z.string().email().max(320).nullable(),
  to: z.array(mailAddressSchema).max(200),
  cc: z.array(mailAddressSchema).max(200),
  bcc: z.array(mailAddressSchema).max(200),
  subject: z.string().max(998),
  body: z.string().max(2 * 1024 * 1024),
  format: z.enum(["plain", "markdown"]),
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
  const html = params.snapshot.format === "markdown" ? sanitizeEmailHtml(markdown.renderSync(params.snapshot.body)) : undefined;
  return new MailComposer({
    from: formatAddress(params.snapshot.from),
    replyTo: params.snapshot.replyTo ?? undefined,
    to: params.snapshot.to.map(formatAddress),
    cc: params.snapshot.cc.map(formatAddress),
    bcc: params.snapshot.bcc.map(formatAddress),
    subject: params.snapshot.subject,
    text: params.snapshot.body,
    html,
    messageId: params.messageId,
    date: params.date,
    inReplyTo: params.snapshot.inReplyTo ?? undefined,
    references: params.snapshot.references,
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
