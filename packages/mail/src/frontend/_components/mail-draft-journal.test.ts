import { describe, expect, test } from "bun:test";
import type { DraftEditableContent } from "../../contracts";
import { advanceMailDraftJournalAfterSave, promoteMailDraftJournal, readMailDraftJournal } from "./mail-draft-journal";

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
  test("advances newer local changes to the saved server revision", () => {
    const target = storage();
    target.setItem("draft", JSON.stringify({ revision: 4, content: content("newer local edit") }));

    expect(
      advanceMailDraftJournalAfterSave({
        storage: target,
        key: "draft",
        revision: 5,
        savedContent: content("submitted save"),
      }),
    ).toBe(true);
    expect(readMailDraftJournal(target, "draft")).toEqual({
      revision: 5,
      content: content("newer local edit"),
    });
  });

  test("removes a journal once its exact content is saved", () => {
    const target = storage();
    target.setItem("draft", JSON.stringify({ revision: 4, content: content("saved") }));

    expect(
      advanceMailDraftJournalAfterSave({
        storage: target,
        key: "draft",
        revision: 5,
        savedContent: content("saved"),
      }),
    ).toBe(false);
    expect(target.getItem("draft")).toBeNull();
  });

  test("promotes current content to the canonical draft key", () => {
    const target = storage();
    target.setItem("pending", JSON.stringify({ revision: 0, content: content("edited before lease") }));
    expect(
      promoteMailDraftJournal({
        storage: target,
        pendingKey: "pending",
        draftKey: "draft",
        revision: 3,
        submittedContent: content("submitted"),
        currentContent: content("edited after lease\n\nSignature"),
        serverContent: content("submitted\n\nSignature"),
      }),
    ).toBe(true);
    expect(readMailDraftJournal(target, "draft")).toEqual({
      revision: 3,
      content: content("edited after lease\n\nSignature"),
    });
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
        submittedContent: content("same"),
        currentContent: content("same"),
        serverContent: content("same"),
      }),
    ).toBe(false);
    expect(target.getItem("draft")).toBeNull();
  });

  test("keeps server enrichment when pending content matches the submitted draft", () => {
    const target = storage();
    target.setItem("pending", JSON.stringify({ revision: 0, content: content("submitted") }));
    expect(
      promoteMailDraftJournal({
        storage: target,
        pendingKey: "pending",
        draftKey: "draft",
        revision: 2,
        submittedContent: content("submitted"),
        currentContent: content("submitted"),
        serverContent: content("submitted\n\nSignature"),
      }),
    ).toBe(false);
    expect(target.getItem("draft")).toBeNull();
    expect(target.getItem("pending")).toBeNull();
  });

  test("removes malformed journals instead of exposing partial content", () => {
    const target = storage();
    target.setItem("draft", JSON.stringify({ revision: 1, content: { body: "partial" } }));
    expect(readMailDraftJournal(target, "draft")).toBeNull();
    expect(target.getItem("draft")).toBeNull();
  });
});
