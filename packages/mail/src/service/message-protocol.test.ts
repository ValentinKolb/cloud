import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import {
  EMPTY_MESSAGE_PROTOCOL_FACTS,
  extractMessageProtocolFacts,
  parseMessageProtocolFacts,
  readMessageRootHeaders,
} from "./message-protocol";

describe("message protocol facts", () => {
  test("extracts bounded standards facts from headers", () => {
    const headers = new Map<string, unknown>([
      ["return-path", "<sender@example.test>"],
      ["auto-submitted", "no"],
      ["list-id", "Example list <list.example.test>"],
      ["list-unsubscribe", "<mailto:leave@example.test>, <https://example.test/unsubscribe>"],
      ["list-unsubscribe-post", "List-Unsubscribe=One-Click"],
      ["importance", "high"],
      ["disposition-notification-to", "sender@example.test"],
      ["x-spam-status", "No, score=-1.0"],
      ["content-type", "multipart/report; report-type=delivery-status"],
    ]);

    expect(extractMessageProtocolFacts((name) => headers.get(name))).toEqual({
      ...EMPTY_MESSAGE_PROTOCOL_FACTS,
      returnPath: "<sender@example.test>",
      autoSubmitted: "no",
      contentType: "multipart/report; report-type=delivery-status",
      deliveryStatus: true,
      list: {
        ...EMPTY_MESSAGE_PROTOCOL_FACTS.list,
        id: "Example list <list.example.test>",
        unsubscribe: ["mailto:leave@example.test", "https://example.test/unsubscribe"],
        unsubscribePost: "List-Unsubscribe=One-Click",
      },
      priority: {
        ...EMPTY_MESSAGE_PROTOCOL_FACTS.priority,
        importance: "high",
      },
      receipts: {
        dispositionNotificationTo: "sender@example.test",
      },
      spam: {
        ...EMPTY_MESSAGE_PROTOCOL_FACTS.spam,
        status: "No, score=-1.0",
      },
    });
  });

  test("fails closed for partial, unknown, or oversized persisted facts", () => {
    expect(parseMessageProtocolFacts({ autoSubmitted: "auto-replied" })).toEqual(EMPTY_MESSAGE_PROTOCOL_FACTS);
    expect(
      parseMessageProtocolFacts({
        ...EMPTY_MESSAGE_PROTOCOL_FACTS,
        unexpected: true,
      }),
    ).toEqual(EMPTY_MESSAGE_PROTOCOL_FACTS);
    expect(
      parseMessageProtocolFacts({
        ...EMPTY_MESSAGE_PROTOCOL_FACTS,
        returnPath: "x".repeat(4_097),
      }),
    ).toEqual(EMPTY_MESSAGE_PROTOCOL_FACTS);
  });

  test("bounds repeated list links before persistence", () => {
    const links = Array.from({ length: 30 }, (_, index) => `<https://example.test/${index}>`).join(", ");
    expect(extractMessageProtocolFacts((name) => (name === "list-unsubscribe" ? links : null)).list.unsubscribe).toHaveLength(20);
  });

  test("reads structured List and Content-Type fields from the exact source headers", async () => {
    const source = Buffer.from(
      [
        "Return-Path: <sender@example.test>",
        "List-Id: Example list <list.example.test>",
        "List-Unsubscribe: <mailto:leave@example.test>,",
        " <https://example.test/unsubscribe>",
        "Content-Type: multipart/report; report-type=delivery-status",
        "",
        "The body is not part of the header projection.",
      ].join("\r\n"),
    );
    const headers = await readMessageRootHeaders(Readable.from([source]));
    const facts = extractMessageProtocolFacts((name) => headers.getFirst(name));

    expect(facts).toMatchObject({
      returnPath: "<sender@example.test>",
      contentType: "multipart/report; report-type=delivery-status",
      deliveryStatus: true,
      list: {
        id: "Example list <list.example.test>",
        unsubscribe: ["mailto:leave@example.test", "https://example.test/unsubscribe"],
      },
    });
  });
});
