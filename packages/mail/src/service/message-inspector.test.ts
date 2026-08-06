import { describe, expect, test } from "bun:test";
import { messageInspectorSchema, messageSourcePreviewSchema } from "../contracts";
import {
  MESSAGE_HEADER_FIELD_LIMIT,
  MESSAGE_HEADER_LIMIT_BYTES,
  MESSAGE_INSPECTOR_ATTACHMENT_LIMIT,
  MESSAGE_INSPECTOR_PART_LIMIT,
  MESSAGE_INSPECTOR_PLACEMENT_LIMIT,
  MESSAGE_SOURCE_PREVIEW_LIMIT_BYTES,
  parseMessageHeaderBlock,
} from "./message-inspector";

const encode = (value: string) => new TextEncoder().encode(value);

describe("message inspector contracts", () => {
  test("keeps repeated and folded headers without accepting malformed lines", () => {
    const parsed = parseMessageHeaderBlock(
      encode(
        [
          "Received: from first.example",
          "Received: from second.example",
          "Subject: A long",
          "\tfolded subject",
          "Invalid Header: value",
          "malformed",
          "",
          "Body",
        ].join("\r\n"),
      ),
    );

    expect(parsed.complete).toBe(true);
    expect(parsed.malformedLines).toBe(2);
    expect(parsed.headers).toEqual([
      { name: "Received", value: "from first.example" },
      { name: "Received", value: "from second.example" },
      { name: "Subject", value: "A long folded subject" },
    ]);
    expect(parsed.rawHeaders).not.toContain("Body");
  });

  test("marks a source without a header boundary as incomplete", () => {
    const parsed = parseMessageHeaderBlock(encode("Subject: no boundary"));
    expect(parsed.complete).toBe(false);
    expect(parsed.headers).toEqual([{ name: "Subject", value: "no boundary" }]);
  });

  test("keeps preview and header limits deliberately bounded", () => {
    expect(MESSAGE_SOURCE_PREVIEW_LIMIT_BYTES).toBe(256 * 1024);
    expect(MESSAGE_HEADER_LIMIT_BYTES).toBe(2 * 1024 * 1024);
    expect(MESSAGE_SOURCE_PREVIEW_LIMIT_BYTES).toBeLessThan(MESSAGE_HEADER_LIMIT_BYTES);
    expect(MESSAGE_HEADER_FIELD_LIMIT).toBe(10_000);
    expect(MESSAGE_INSPECTOR_PLACEMENT_LIMIT).toBe(1000);
    expect(MESSAGE_INSPECTOR_PART_LIMIT).toBe(10_000);
    expect(MESSAGE_INSPECTOR_ATTACHMENT_LIMIT).toBe(10_000);
  });

  test("bounds the number of parsed header fields", () => {
    const source = `${Array.from({ length: MESSAGE_HEADER_FIELD_LIMIT + 1 }, (_, index) => `X-${index}: value`).join("\r\n")}\r\n\r\nbody`;
    const parsed = parseMessageHeaderBlock(encode(source));

    expect(parsed.headers).toHaveLength(MESSAGE_HEADER_FIELD_LIMIT);
    expect(parsed.fieldLimitReached).toBe(true);
  });

  test("rejects unbounded or structurally invalid response values", () => {
    expect(
      messageSourcePreviewSchema.safeParse({
        messageId: "00000000-0000-4000-8000-000000000001",
        exact: true,
        text: "source",
        byteLength: 6,
        previewByteLength: 6,
        truncated: false,
      }).success,
    ).toBe(true);
    expect(
      messageInspectorSchema.safeParse({
        id: "not-a-message-id",
      }).success,
    ).toBe(false);
  });
});
