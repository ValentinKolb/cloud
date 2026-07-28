import { describe, expect, test } from "bun:test";
import { commitMailRecipient, formatMailRecipients, parseMailRecipients, shouldCommitMailRecipient } from "./mail-recipient";

describe("mail recipient tokens", () => {
  test("round-trips display names", () => {
    const recipients = [{ name: "Ada Lovelace", address: "ada@example.test" }];
    expect(parseMailRecipients(formatMailRecipients(recipients))).toEqual(recipients);
  });

  test("normalizes and deduplicates addresses", () => {
    expect(parseMailRecipients(["ADA@example.test", "Ada Lovelace <ada@example.test>"])).toEqual([
      { name: "Ada Lovelace", address: "ada@example.test" },
    ]);
  });

  test("drops invalid recipient tokens before draft persistence", () => {
    expect(parseMailRecipients(["not an address", "valid@example.test"])).toEqual([{ name: null, address: "valid@example.test" }]);
  });

  test("adds and replaces formatted recipient tokens", () => {
    expect(commitMailRecipient(["one@example.test"], "Ada Lovelace <ADA@example.test>")).toEqual([
      "one@example.test",
      "Ada Lovelace <ada@example.test>",
    ]);
    expect(commitMailRecipient(["one@example.test", "two@example.test"], "updated@example.test", 0)).toEqual([
      "updated@example.test",
      "two@example.test",
    ]);
    expect(commitMailRecipient(["one@example.test"], "not an address")).toBeNull();
  });

  test("accepts space as a separator only after a complete address", () => {
    expect(shouldCommitMailRecipient("ada@example.test", " ")).toBeTrue();
    expect(shouldCommitMailRecipient("Ada Lovelace", " ")).toBeFalse();
    expect(shouldCommitMailRecipient("Ada Lovelace <ada@example.test>", " ")).toBeTrue();
    expect(shouldCommitMailRecipient("ada@example.test", ",")).toBeTrue();
    expect(shouldCommitMailRecipient("", "Enter")).toBeFalse();
  });
});
