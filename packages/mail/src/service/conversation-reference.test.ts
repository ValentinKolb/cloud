import { describe, expect, test } from "bun:test";
import { formatConversationReference, validateConversationReferencePattern } from "./conversation-reference";

describe("conversation references", () => {
  test("formats stable UTC year and padded sequence tokens", () => {
    expect(
      formatConversationReference({
        pattern: "SUP-{year}-{sequence:6}",
        sequence: 42n,
        allocatedAt: new Date("2026-12-31T23:30:00-02:00"),
      }),
    ).toEqual({ ok: true, data: "SUP-2027-000042" });
  });

  test("requires exactly one sequence token", () => {
    expect(validateConversationReferencePattern("SUP-{year}").ok).toBe(false);
    expect(validateConversationReferencePattern("SUP-{sequence}-{sequence:4}").ok).toBe(false);
  });

  test("rejects unknown, malformed, and excessive-width tokens", () => {
    expect(validateConversationReferencePattern("SUP-{mailbox}-{sequence}").ok).toBe(false);
    expect(validateConversationReferencePattern("SUP-{sequence").ok).toBe(false);
    expect(validateConversationReferencePattern("SUP-{sequence:13}").ok).toBe(false);
  });

  test("rejects non-positive sequence values", () => {
    expect(formatConversationReference({ pattern: "SUP-{sequence}", sequence: 0n, allocatedAt: new Date() }).ok).toBe(false);
  });
});
