import { describe, expect, test } from "bun:test";
import { visibleInvitationAttendees } from "./calendar-invitations";

describe("Mail calendar invitations", () => {
  test("uses visible recipients only and normalizes duplicates without exposing Bcc", () => {
    const draft = {
      to: [
        { name: " Recipient ", address: "Visible@Example.Test" },
        { name: "Organizer", address: "sender@example.test" },
      ],
      cc: [
        { name: "Duplicate", address: "visible@example.test" },
        { name: null, address: "cc@example.test" },
      ],
      bcc: [{ name: "Hidden", address: "hidden@example.test" }],
    };

    expect(visibleInvitationAttendees(draft, "Sender@Example.Test")).toEqual([
      { name: "Recipient", address: "visible@example.test" },
      { name: null, address: "cc@example.test" },
    ]);
  });
});
