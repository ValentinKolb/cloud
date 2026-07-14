import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { decodeDocumentRunCursor, encodeDocumentRunCursor } from "./document-run-values";

describe("document run cursors", () => {
  test("round-trips a valid generated-at and UUID pair", () => {
    const value = { generatedAt: "2026-07-14T00:00:00.000Z", id: "11111111-1111-4111-8111-111111111111" };
    expect(decodeDocumentRunCursor(encodeDocumentRunCursor(value))).toEqual(value);
  });

  test("rejects structurally valid cursors with invalid SQL values", () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    expect(decodeDocumentRunCursor(encode({ generatedAt: "not-a-date", id: "not-a-uuid" }))).toBeNull();
    expect(decodeDocumentRunCursor(encode({ generatedAt: "2026-07-14T00:00:00.000Z", id: "not-a-uuid" }))).toBeNull();
  });
});
