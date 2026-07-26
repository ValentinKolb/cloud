import { describe, expect, test } from "bun:test";
import { buildMailActionInput, getMailAction, MAIL_ACTION_IDS, spamActionForFolder } from "./mail-actions";

describe("Mail actions", () => {
  test("defines every action exactly once", () => {
    expect(new Set(MAIL_ACTION_IDS).size).toBe(MAIL_ACTION_IDS.length);
    for (const id of MAIL_ACTION_IDS) expect(getMailAction(id).id).toBe(id);
    expect(getMailAction("flag").icon).toBe("ti ti-flag");
  });

  test("builds provider move inputs", () => {
    expect(
      buildMailActionInput({
        actionId: "move",
        sourceFolderId: "source",
        destinationFolderId: "target",
        idempotencyKey: "idem",
        correlationId: "corr",
      }),
    ).toMatchObject({ kind: "move_to_folder", sourceFolderId: "source", destinationFolderId: "target" });
    expect(
      buildMailActionInput({
        actionId: "not_spam",
        sourceFolderId: "junk",
        idempotencyKey: "not-spam",
        correlationId: "corr",
      }),
    ).toMatchObject({ kind: "move_to_role", sourceFolderId: "junk", role: "inbox" });
  });

  test("uses not-spam only for messages currently shown from junk", () => {
    expect(spamActionForFolder("junk-folder", ["junk-folder"])).toBe("not_spam");
    expect(spamActionForFolder("inbox-folder", ["junk-folder"])).toBe("junk");
    expect(spamActionForFolder(null, ["junk-folder"])).toBe("junk");
  });
});
