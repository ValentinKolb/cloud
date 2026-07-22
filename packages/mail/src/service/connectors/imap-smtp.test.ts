import { describe, expect, test } from "bun:test";
import type { ListResponse } from "imapflow";
import { assertUidValidity, parseEnvelopeHeaders, parseReferences, renameImapFolder, selectUidBatch } from "./imap-smtp";

const sparseSearch = (uids: number[], probes: Array<[number, number]>) => async (lowUid: number, highUid: number) => {
  probes.push([lowUid, highUid]);
  return uids.filter((uid) => uid >= lowUid && uid <= highUid);
};

const listedFolder = (path: string, subscribed: boolean): ListResponse => ({
  path,
  pathAsListed: path,
  name: path,
  delimiter: "/",
  flags: new Set(),
  listed: true,
  subscribed,
  parent: [],
  parentPath: "",
});

describe("IMAP envelope UID batching", () => {
  test("finds existing messages without scanning every sparse UID window", async () => {
    const probes: Array<[number, number]> = [];
    const first = await selectUidBatch({
      lowUid: 1,
      highUid: 10_000_000,
      limit: 2,
      search: sparseSearch([3, 100, 9_999_999], probes),
    });
    expect(first).toEqual({ uids: [100, 9_999_999], nextHighUid: 99 });
    expect(probes.length).toBeLessThanOrEqual(12);

    const second = await selectUidBatch({
      lowUid: 1,
      highUid: first.nextHighUid!,
      limit: 2,
      search: sparseSearch([3, 100, 9_999_999], []),
    });
    expect(second).toEqual({ uids: [3], nextHighUid: null });
  });

  test("returns the newest dense batch and a stable continuation", async () => {
    const all = Array.from({ length: 1_000 }, (_, index) => index + 1);
    const result = await selectUidBatch({
      lowUid: 1,
      highUid: 1_000,
      limit: 200,
      search: sparseSearch(all, []),
    });
    expect(result.uids).toEqual(Array.from({ length: 200 }, (_, index) => index + 801));
    expect(result.nextHighUid).toBe(800);
  });
});

describe("IMAP References parsing", () => {
  test("completes for an empty header block", async () => {
    expect(await parseReferences(Buffer.from("\r\n"))).toEqual([]);
  });

  test("returns every referenced Message-ID", async () => {
    expect(await parseReferences(Buffer.from("References: <first@example.com> <second@example.com>\r\n\r\n"))).toEqual([
      "<first@example.com>",
      "<second@example.com>",
    ]);
  });

  test("freezes protocol facts used by automatic reply guards", async () => {
    const parsed = await parseEnvelopeHeaders(
      Buffer.from(
        [
          "References: <first@example.com>",
          "Return-Path: <sender@example.com>",
          "Auto-Submitted: no",
          "Precedence: bulk",
          "List-ID: Example list <list.example.com>",
          "X-Auto-Response-Suppress: OOF, AutoReply",
          "Content-Type: multipart/report; report-type=delivery-status",
          "",
          "",
        ].join("\r\n"),
      ),
    );
    expect(parsed.references).toEqual(["<first@example.com>"]);
    expect(parsed.protocolFacts).toEqual({
      returnPath: "<sender@example.com>",
      autoSubmitted: "no",
      precedence: "bulk",
      listId: "Example list <list.example.com>",
      autoResponseSuppress: "OOF, AutoReply",
      contentType: "multipart/report; report-type=delivery-status",
      deliveryStatus: true,
    });
  });
});

describe("IMAP folder rename", () => {
  test("restores a subscription that the provider drops during rename", async () => {
    const calls: string[] = [];
    await renameImapFolder(
      {
        list: async () => [listedFolder("Cloud Source", true)],
        mailboxRename: async (path, newPath) => {
          calls.push(`rename:${String(path)}:${String(newPath)}`);
          return { path: String(newPath), newPath: String(newPath) };
        },
        mailboxSubscribe: async (path) => {
          calls.push(`subscribe:${String(path)}`);
          return true;
        },
      },
      "Cloud Source",
      "Cloud Renamed",
    );

    expect(calls).toEqual(["rename:Cloud Source:Cloud Renamed", "subscribe:Cloud Renamed"]);
  });

  test("does not add a subscription to an unsubscribed folder", async () => {
    let subscribed = false;
    await renameImapFolder(
      {
        list: async () => [listedFolder("Cloud Source", false)],
        mailboxRename: async () => ({ path: "Cloud Renamed", newPath: "Cloud Renamed" }),
        mailboxSubscribe: async () => {
          subscribed = true;
          return true;
        },
      },
      "Cloud Source",
      "Cloud Renamed",
    );

    expect(subscribed).toBe(false);
  });

  test("reports a partial failure when the rename succeeded but resubscribe did not", async () => {
    await expect(
      renameImapFolder(
        {
          list: async () => [listedFolder("Cloud Source", true)],
          mailboxRename: async () => ({ path: "Cloud Renamed", newPath: "Cloud Renamed" }),
          mailboxSubscribe: async () => false,
        },
        "Cloud Source",
        "Cloud Renamed",
      ),
    ).rejects.toMatchObject({ code: "REMOTE_RENAME_SUBSCRIBE_PARTIAL" });
  });
});

describe("IMAP UIDVALIDITY fencing", () => {
  test("rejects stale or unavailable selected mailbox identities", () => {
    expect(() => assertUidValidity("42", "42")).not.toThrow();
    expect(() => assertUidValidity("43", "42")).toThrow(expect.objectContaining({ code: "UIDVALIDITY_CHANGED" }));
    expect(() => assertUidValidity(null, "42")).toThrow(expect.objectContaining({ code: "UIDVALIDITY_CHANGED" }));
  });
});
