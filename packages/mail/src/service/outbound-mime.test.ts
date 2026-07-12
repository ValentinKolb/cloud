import { describe, expect, test } from "bun:test";
import { simpleParser } from "mailparser";
import { buildMimeSource, outboundDraftSnapshotSchema, outboundRecipients } from "./outbound-mime";

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
});
