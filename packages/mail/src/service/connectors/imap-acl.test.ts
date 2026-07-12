import { describe, expect, test } from "bun:test";
import type { ImapFlow } from "imapflow";
import { mapImapAclRights, readImapAclRights, selectFallbackRights } from "./imap-acl";

describe("IMAP ACL rights", () => {
  test("maps RFC 4314 rights conservatively", () => {
    expect(mapImapAclRights("lrswite", { move: false, uidplus: true })).toEqual([
      "read",
      "write_flags",
      "insert",
      "move",
      "delete_messages",
    ]);
    expect(mapImapAclRights("lrswitekxa", { move: true, uidplus: true })).toEqual([
      "read",
      "write_flags",
      "insert",
      "move",
      "delete_messages",
      "create_children",
      "delete_folder",
      "administer_acl",
    ]);
    expect(mapImapAclRights("lrswid", { move: true, uidplus: true })).toEqual([
      "read",
      "write_flags",
      "insert",
      "move",
      "delete_messages",
      "delete_folder",
    ]);
    expect(mapImapAclRights("lrsi", { move: true, uidplus: true })).toEqual(["read", "insert"]);
    expect(mapImapAclRights("lrstw", { move: false, uidplus: false })).toEqual(["read", "write_flags"]);
  });

  test("reads MYRIGHTS through the connector-contained raw command adapter", async () => {
    let advanced = false;
    const client = {
      enabled: new Set<string>(),
      exec: async (_command: string, _attributes: unknown, options: { untagged: Record<string, (value: unknown) => void> }) => {
        options.untagged.MYRIGHTS?.({ attributes: [{ value: "INBOX" }, { value: "lrswite" }] });
        return { next: () => (advanced = true) };
      },
    } as unknown as ImapFlow;
    await expect(readImapAclRights(client, "INBOX", { acl: true, move: true, uidplus: true })).resolves.toEqual({
      rights: ["read", "write_flags", "insert", "move", "delete_messages"],
      source: "acl",
      rawAclRights: "lrswite",
    });
    expect(advanced).toBe(true);
  });

  test("uses an explicit select fallback only when ACL is unavailable", async () => {
    const client = { enabled: new Set<string>() } as unknown as ImapFlow;
    await expect(readImapAclRights(client, "INBOX", { acl: false, move: true, uidplus: true })).resolves.toBeNull();
    expect(selectFallbackRights(true, { move: true, uidplus: true })).toEqual({ rights: ["read"], source: "select", rawAclRights: null });
    expect(selectFallbackRights(false, { move: false, uidplus: false })).toEqual({
      rights: ["read", "write_flags", "insert"],
      source: "select",
      rawAclRights: null,
    });
  });
});
