import { describe, expect, test } from "bun:test";
import type { DraftEditableContent, MailDraft } from "../../contracts";
import { createSerializedDraftMutationQueue, mergeCreatedDraftContent } from "./mail-draft-session";

const content = (body: string): DraftEditableContent => ({
  senderIdentityId: "identity-1",
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  body,
  format: "plain",
  priority: "normal",
  requestDeliveryReceipt: false,
  requestReadReceipt: false,
});

const createdDraft = (body: string, signature = ""): MailDraft =>
  ({
    ...content(body),
    initialSignatureSource: signature,
  }) as MailDraft;

describe("mergeCreatedDraftContent", () => {
  test("uses the server draft when local content did not change during creation", () => {
    const submitted = content("Hello");
    const created = createdDraft("Hello\n\nRegards", "Regards");

    expect(mergeCreatedDraftContent(submitted, submitted, created)).toEqual(created);
  });

  test("preserves concurrent local edits and appends the server signature", () => {
    const submitted = content("");
    const current = content("Typed while creating");
    const created = createdDraft("Regards", "Regards");

    expect(mergeCreatedDraftContent(current, submitted, created)).toEqual(content("Typed while creating\n\nRegards"));
  });

  test("does not overwrite local edits when the identity changed", () => {
    const submitted = content("");
    const current = { ...content("Typed while creating"), senderIdentityId: "identity-2" };

    expect(mergeCreatedDraftContent(current, submitted, createdDraft("Regards", "Regards"))).toBeNull();
  });
});

describe("createSerializedDraftMutationQueue", () => {
  test("serializes operations and continues after a rejection", async () => {
    const serialize = createSerializedDraftMutationQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = serialize(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      throw new Error("expected");
    });
    const second = serialize(async () => {
      events.push("second");
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst?.();
    await expect(first).rejects.toThrow("expected");
    expect(await second).toBe(2);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });
});
