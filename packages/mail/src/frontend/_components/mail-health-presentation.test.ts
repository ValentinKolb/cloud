import { describe, expect, test } from "bun:test";
import { mailboxHealthMessage } from "./mail-health-presentation";

describe("mailboxHealthMessage", () => {
  test("does not expose raw provider errors", () => {
    expect(mailboxHealthMessage("paused")).toContain("paused");
    expect(mailboxHealthMessage("unknown")).not.toContain("unknown");
  });
});
