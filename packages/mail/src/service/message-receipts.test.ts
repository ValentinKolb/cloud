import { describe, expect, test } from "bun:test";
import { parseMessageReceiptSource } from "./message-receipts";

describe("message receipt reports", () => {
  test("parses a delivery report using the stable outbox envelope id", () => {
    expect(
      parseMessageReceiptSource(
        [
          "Content-Type: multipart/report; report-type=delivery-status",
          "",
          "--boundary",
          "Content-Type: message/delivery-status",
          "",
          "Original-Envelope-Id: 00000000-0000-4000-8000-000000000001",
          "Final-Recipient: rfc822; recipient@example.test",
          "Action: delivered",
          "Status: 2.0.0",
        ].join("\r\n"),
      ),
    ).toEqual({
      kind: "delivery",
      status: "delivered",
      originalEnvelopeId: "00000000-0000-4000-8000-000000000001",
      originalMessageId: null,
    });
  });

  test("uses the most severe outcome in a multi-recipient delivery report", () => {
    expect(
      parseMessageReceiptSource(
        [
          "Content-Type: multipart/report; report-type=delivery-status",
          "",
          "Original-Message-ID: <stable@example.test>",
          "Action: delivered",
          "",
          "Action: failed",
        ].join("\n"),
      )?.status,
    ).toBe("failed");
  });

  test("parses a read receipt without treating it as proof beyond the reported disposition", () => {
    expect(
      parseMessageReceiptSource(
        [
          "Content-Type: multipart/report;",
          " report-type=disposition-notification",
          "",
          "Original-Message-ID: <Stable@Example.Test>",
          "Disposition: manual-action/MDN-sent-manually; displayed",
        ].join("\r\n"),
      ),
    ).toEqual({
      kind: "read",
      status: "displayed",
      originalEnvelopeId: null,
      originalMessageId: "stable@example.test",
    });
  });

  test("rejects ambiguous and unrelated reports", () => {
    expect(
      parseMessageReceiptSource(
        [
          "Content-Type: multipart/report; report-type=delivery-status",
          "",
          "Original-Message-ID: <first@example.test>",
          "Original-Message-ID: <second@example.test>",
          "Action: delivered",
        ].join("\n"),
      ),
    ).toBeNull();
    expect(parseMessageReceiptSource("Content-Type: text/plain\n\nOriginal-Message-ID: <stable@example.test>")).toBeNull();
  });
});
