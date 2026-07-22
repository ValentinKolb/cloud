import { describe, expect, test } from "bun:test";
import { evaluateAutoReplyPolicy, parseConnectorProtocolFacts, parseReturnPathAddress, type AutoReplyFacts } from "./auto-reply-policy";

const inbound = (overrides: Partial<AutoReplyFacts> = {}): AutoReplyFacts => ({
  senderAddresses: ["customer@example.test"],
  mailboxAddresses: ["support@example.test"],
  returnPath: "<customer@example.test>",
  autoSubmitted: "no",
  ...overrides,
});

describe("evaluateAutoReplyPolicy", () => {
  test("allows an ordinary inbound message", () => {
    expect(evaluateAutoReplyPolicy(inbound())).toEqual({ allowed: true, reasons: [] });
  });

  test("blocks automated senders and null reverse paths", () => {
    expect(
      evaluateAutoReplyPolicy(
        inbound({
          returnPath: "<>",
          autoSubmitted: "auto-replied",
          autoResponseSuppress: "OOF, AutoReply",
        }),
      ),
    ).toEqual({
      allowed: false,
      reasons: ["null_return_path", "automated_message", "sender_suppressed"],
    });
  });

  test("blocks self replies, list traffic, and delivery reports", () => {
    expect(
      evaluateAutoReplyPolicy(
        inbound({
          senderAddresses: ["SUPPORT@example.test"],
          precedence: "bulk",
          listId: "announcements.example.test",
          deliveryStatus: true,
        }),
      ),
    ).toEqual({
      allowed: false,
      reasons: ["mailbox_sender", "bulk_message", "mailing_list", "delivery_status"],
    });
  });

  test("blocks duplicate replies and messages without a usable sender", () => {
    expect(evaluateAutoReplyPolicy(inbound({ senderAddresses: [], alreadyReplied: true }))).toEqual({
      allowed: false,
      reasons: ["missing_sender", "already_replied"],
    });
  });

  test("keeps protocol facts when hydration adds unrelated selected headers", () => {
    expect(
      parseConnectorProtocolFacts({
        returnPath: "<sender@example.test>",
        autoSubmitted: "no",
        precedence: null,
        listId: null,
        autoResponseSuppress: null,
        contentType: "text/plain",
        deliveryStatus: false,
        "message-id": "<message@example.test>",
      }),
    ).toMatchObject({ returnPath: "<sender@example.test>", autoSubmitted: "no", deliveryStatus: false });
  });

  test("normalizes partial facts recovered from hydrated source headers", () => {
    expect(parseConnectorProtocolFacts({ autoSubmitted: "auto-replied" })).toEqual({
      returnPath: null,
      autoSubmitted: "auto-replied",
      precedence: null,
      listId: null,
      autoResponseSuppress: null,
      contentType: null,
      deliveryStatus: false,
    });
  });

  test("accepts exactly one non-null return path address", () => {
    expect(parseReturnPathAddress("<Sender@Example.test>")).toBe("sender@example.test");
    expect(parseReturnPathAddress("<>")).toBeNull();
    expect(parseReturnPathAddress("first@example.test, second@example.test")).toBeNull();
  });
});
