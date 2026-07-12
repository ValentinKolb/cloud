import { describe, expect, test } from "bun:test";
import { simpleParser } from "mailparser";
import { Readable } from "node:stream";
import { buildMimeSource, buildMimeStream, outboundDraftSnapshotSchema, outboundRecipients } from "./outbound-mime";

describe("outbound MIME", () => {
  test("builds a stable threaded multipart message without exposing Bcc", async () => {
    const snapshot = outboundDraftSnapshotSchema.parse({
      revision: 3,
      from: { name: "Support", address: "support@example.com" },
      replyTo: null,
      envelopeFrom: null,
      to: [{ name: "Alice", address: "alice@example.com" }],
      cc: [],
      bcc: [{ name: null, address: "audit@example.com" }],
      subject: "Re: Request",
      body: "Hello **Alice**\n\n<script>alert('xss')</script>\n\n[unsafe](javascript:alert(1))",
      format: "markdown",
      inReplyTo: "<parent@example.com>",
      references: ["<root@example.com>", "<parent@example.com>"],
    });
    const source = await buildMimeSource({
      snapshot,
      messageId: "<stable@example.com>",
      date: new Date("2026-01-02T03:04:05.000Z"),
    });
    const parsed = await simpleParser(source);
    expect(parsed.messageId).toBe("<stable@example.com>");
    expect(parsed.inReplyTo).toBe("<parent@example.com>");
    expect(parsed.text).toContain("Hello **Alice**");
    expect(parsed.html).toContain("<strong>Alice</strong>");
    expect(parsed.html).not.toContain("<script");
    expect(parsed.html).not.toContain("javascript:");
    expect(source.toString("utf8")).not.toMatch(/^Bcc:/im);
    expect(outboundRecipients(snapshot)).toEqual(["alice@example.com", "audit@example.com"]);
  });

  test("streams attachment content into MIME without changing bytes", async () => {
    const attachment = Buffer.alloc(3 * 1024 * 1024 + 17);
    for (let index = 0; index < attachment.length; index += 1) attachment[index] = (index * 31) % 256;
    const blobId = "00000000-0000-4000-8000-000000000001";
    const snapshot = outboundDraftSnapshotSchema.parse({
      revision: 1,
      from: { name: "Support", address: "support@example.com" },
      replyTo: null,
      envelopeFrom: null,
      to: [{ name: null, address: "alice@example.com" }],
      cc: [],
      bcc: [],
      subject: "Attachment stream",
      body: "Attached.",
      format: "plain",
      inReplyTo: null,
      references: [],
      attachments: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          blobId,
          filename: "payload.bin",
          contentType: "application/octet-stream",
          byteLength: attachment.length,
          contentHash: "a".repeat(64),
        },
      ],
    });
    let opened = 0;
    const source = buildMimeStream({
      snapshot,
      messageId: "<attachment@example.com>",
      date: new Date("2026-07-12T12:00:00.000Z"),
      openAttachment: (requestedBlobId) => {
        expect(requestedBlobId).toBe(blobId);
        opened += 1;
        return Readable.from((async function* () {
          for (let offset = 0; offset < attachment.length; offset += 64 * 1024) {
            yield attachment.subarray(offset, Math.min(offset + 64 * 1024, attachment.length));
          }
        })());
      },
    });
    const parsed = await simpleParser(source);

    expect(opened).toBe(1);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.filename).toBe("payload.bin");
    expect(parsed.attachments[0]?.content.equals(attachment)).toBe(true);
  });
});
