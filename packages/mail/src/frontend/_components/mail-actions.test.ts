import { describe, expect, test } from "bun:test";
import { buildMailActionInput, getMailAction, MAIL_ACTION_IDS } from "./mail-actions";

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
  });
});
