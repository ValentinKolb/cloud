import { describe, expect, test } from "bun:test";
import type { DraftEditableContent } from "../../contracts";
import { promoteMailDraftJournal, readMailDraftJournal } from "./mail-draft-journal";

const content = (body: string): DraftEditableContent => ({
  senderIdentityId: "00000000-0000-4000-8000-000000000001",
  to: [],
  cc: [],
  bcc: [],
  subject: "Subject",
  body,
  format: "plain",
  priority: "normal",
  requestDeliveryReceipt: false,
  requestReadReceipt: false,
});

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

describe("mail draft journals", () => {
  test("promotes newer pending content to the canonical draft key", () => {
    const target = storage();
    target.setItem("pending", JSON.stringify({ revision: 0, content: content("newer") }));
    expect(
      promoteMailDraftJournal({
        storage: target,
        pendingKey: "pending",
        draftKey: "draft",
        revision: 3,
        fallbackContent: content("fallback"),
        serverContent: content("submitted"),
      }),
    ).toBe(true);
    expect(readMailDraftJournal(target, "draft")).toEqual({ revision: 3, content: content("newer") });
    expect(target.getItem("pending")).toBeNull();
  });

  test("does not retain a journal when local and server content match", () => {
    const target = storage();
    expect(
      promoteMailDraftJournal({
        storage: target,
        pendingKey: "pending",
        draftKey: "draft",
        revision: 1,
        fallbackContent: content("same"),
        serverContent: content("same"),
      }),
    ).toBe(false);
    expect(target.getItem("draft")).toBeNull();
  });

  test("removes malformed journals instead of exposing partial content", () => {
    const target = storage();
    target.setItem("draft", JSON.stringify({ revision: 1, content: { body: "partial" } }));
    expect(readMailDraftJournal(target, "draft")).toBeNull();
    expect(target.getItem("draft")).toBeNull();
  });
});
