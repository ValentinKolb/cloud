import { describe, expect, test } from "bun:test";
import type { MailDraft } from "../../contracts";
import { isClosedMailDraft, mailDraftLifecycleMessage, mailDraftLifecycleTitle, reconcileMailDraftLifecycle } from "./mail-draft-lifecycle";

const draft = (state: MailDraft["state"]): MailDraft =>
  ({
    state,
    lastEditedByDisplayName: "Ada Lovelace",
  }) as MailDraft;

describe("mail draft lifecycle", () => {
  test("keeps only editable drafts open", () => {
    expect(isClosedMailDraft(draft("draft"))).toBeFalse();
    for (const state of ["scheduled", "sending", "sent", "discarded"] as const) {
      expect(isClosedMailDraft(draft(state))).toBeTrue();
    }
  });

  test("explains the authoritative transition and actor", () => {
    const scheduled = draft("scheduled");
    const sending = draft("sending");
    const sent = draft("sent");
    if (!isClosedMailDraft(scheduled) || !isClosedMailDraft(sending) || !isClosedMailDraft(sent)) {
      throw new Error("Expected closed drafts");
    }
    expect(mailDraftLifecycleMessage(scheduled)).toBe("This message was scheduled by Ada Lovelace.");
    expect(mailDraftLifecycleMessage(sending)).toBe("Ada Lovelace started sending this message.");
    expect(mailDraftLifecycleMessage(sent)).toBe("This message was sent by Ada Lovelace.");
    expect(mailDraftLifecycleTitle("discarded")).toBe("Draft discarded");
  });

  test("advances from scheduled to sent without losing the local-change warning", () => {
    const scheduled = reconcileMailDraftLifecycle(null, draft("scheduled"), true);
    const sent = reconcileMailDraftLifecycle(scheduled, draft("sent"), false);
    expect(sent?.draft.state).toBe("sent");
    expect(sent?.hasUnsavedChanges).toBeTrue();
  });
});
