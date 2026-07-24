import { describe, expect, test } from "bun:test";
import { __test, mailingListMetadata, subscriptionLink } from "./list-subscriptions";
import { EMPTY_MESSAGE_PROTOCOL_FACTS } from "./message-protocol";

const publicLookup = async () => [{ address: "1.1.1.1", family: 4 as const }];

describe("mailing-list subscription metadata", () => {
  test("derives one canonical list context for API and inspector views", () => {
    expect(
      mailingListMetadata({
        ...EMPTY_MESSAGE_PROTOCOL_FACTS,
        list: {
          id: "Project Updates <Updates.Example.test>",
          unsubscribe: ["https://lists.example.test/unsubscribe"],
          unsubscribePost: "List-Unsubscribe=One-Click",
          post: ["mailto:updates@example.test"],
          help: ["https://lists.example.test/help"],
          archive: ["https://lists.example.test/archive"],
        },
      }),
    ).toEqual({
      listKey: "updates.example.test",
      name: "Project Updates",
      address: "updates.example.test",
      unsubscribe: { kind: "one_click", href: "https://lists.example.test/unsubscribe" },
      postHref: "mailto:updates@example.test",
      helpHref: "https://lists.example.test/help",
      archiveHref: "https://lists.example.test/archive",
    });
  });

  test("normalizes named and bare List-ID values", () => {
    expect(__test.normalizeListId("Example updates <News.Example.test>")).toEqual({
      key: "news.example.test",
      name: "Example updates",
      address: "news.example.test",
    });
    expect(__test.normalizeListId("News.Example.test")).toEqual({
      key: "news.example.test",
      name: "News.Example.test",
      address: "news.example.test",
    });
  });

  test("selects one-click only when RFC 8058 is advertised", () => {
    expect(subscriptionLink(["mailto:leave@example.test", "https://example.test/unsubscribe"], "List-Unsubscribe=One-Click")).toEqual({
      kind: "one_click",
      href: "https://example.test/unsubscribe",
    });
    expect(subscriptionLink(["https://example.test/unsubscribe"], null)).toEqual({
      kind: "web",
      href: "https://example.test/unsubscribe",
    });
    expect(subscriptionLink(["mailto:leave@example.test"], null)).toEqual({
      kind: "email",
      href: "mailto:leave@example.test",
    });
  });

  test("rejects executable and credential-bearing links", () => {
    expect(__test.allowedExternalHref("javascript:alert(1)")).toBeNull();
    expect(__test.allowedExternalHref("https://user:secret@example.test/unsubscribe")).toBeNull();
    expect(subscriptionLink(["javascript:alert(1)"], "List-Unsubscribe=One-Click")).toBeNull();
  });
});

describe("one-click unsubscribe transport", () => {
  test("rejects private DNS targets before sending", async () => {
    let sent = false;
    await expect(
      __test.postOneClick("https://example.test/unsubscribe", {
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
        request: async () => {
          sent = true;
          return { statusCode: 204, location: null };
        },
      }),
    ).rejects.toThrow("private or reserved");
    expect(sent).toBe(false);
  });

  test("follows bounded 307 redirects and revalidates every target", async () => {
    const requests: string[] = [];
    await __test.postOneClick("https://example.test/unsubscribe", {
      lookup: publicLookup,
      request: async (url) => {
        requests.push(url.toString());
        return requests.length === 1
          ? { statusCode: 307, location: "https://redirect.example.test/confirm" }
          : { statusCode: 204, location: null };
      },
    });
    expect(requests).toEqual(["https://example.test/unsubscribe", "https://redirect.example.test/confirm"]);
  });

  test("rejects redirects that can change POST semantics", async () => {
    await expect(
      __test.postOneClick("https://example.test/unsubscribe", {
        lookup: publicLookup,
        request: async () => ({ statusCode: 302, location: "https://example.test/complete" }),
      }),
    ).rejects.toThrow("unsafe redirect");
  });
});
