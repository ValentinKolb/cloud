import { describe, expect, test } from "bun:test";
import { buildSpacesEventHandoffHref } from "./mail-spaces-event-route";

describe("buildSpacesEventHandoffHref", () => {
  test("passes only bounded identifiers to the canonical Spaces editor", () => {
    expect(
      buildSpacesEventHandoffHref({
        origin: "https://cloud.example.test",
        spaceId: "space-1",
        mailboxId: "mailbox-1",
        messageId: "message-1",
      }),
    ).toBe("/app/spaces/space-1?create=event&mailbox=mailbox-1&message=message-1");
  });
});
