import { describe, expect, test } from "bun:test";
import { formatMailRecipients, parseMailRecipients } from "./mail-recipient";

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
});
