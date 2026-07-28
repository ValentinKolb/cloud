import { describe, expect, test } from "bun:test";
import { addConversationReferenceToReplySubject, formatConversationReference } from "./conversation-reference";

describe("conversation reference formatting", () => {
  test("renders supported tokens", () => {
    const result = formatConversationReference({
      pattern: "SUP-{{ year }}-{{ sequence | pad_start: 6 }}",
      sequence: 42n,
      allocatedAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    expect(result).toEqual({ ok: true, data: "SUP-2026-000042" });
  });

  test("requires one safe sequence output", () => {
    expect(
      formatConversationReference({
        pattern: "SUP-{{ year }}",
        sequence: 42n,
        allocatedAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).toMatchObject({ ok: false });
    expect(
      formatConversationReference({
        pattern: "{% if year %}{{ sequence }}{% endif %}",
        sequence: 42n,
        allocatedAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).toMatchObject({ ok: false });
    expect(
      formatConversationReference({
        pattern: "MAILSEQUENCECHECK",
        sequence: 42n,
        allocatedAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).toMatchObject({ ok: false });
  });

  test("adds one reference after the reply prefix", () => {
    expect(addConversationReferenceToReplySubject("Original subject", "SUP-2026-000042")).toBe("Re: [SUP-2026-000042] Original subject");
    expect(addConversationReferenceToReplySubject("RE: Original subject", "SUP-2026-000042")).toBe(
      "Re: [SUP-2026-000042] Original subject",
    );
    expect(addConversationReferenceToReplySubject("Re: [SUP-2026-000042] Original subject", "SUP-2026-000042")).toBe(
      "Re: [SUP-2026-000042] Original subject",
    );
  });

  test("keeps the resulting subject inside the mail limit", () => {
    expect(addConversationReferenceToReplySubject("x".repeat(2_000), "SUP-42")).toHaveLength(998);
  });
});
