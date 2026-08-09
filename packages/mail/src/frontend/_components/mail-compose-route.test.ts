import { describe, expect, test } from "bun:test";
import { mailDraftHref, mailDraftReturnHref, mailDraftSeedHref, mailtoHandlerTemplate, registerMailtoHandler } from "./mail-compose-route";

describe("Mail compose routes", () => {
  test("keeps only same-mailbox workspace return locations", () => {
    const mailboxId = "10000000-0000-4000-8000-000000000001";
    expect(mailDraftReturnHref(`/app/mail/${mailboxId}?conversation=one#message`, mailboxId)).toBe(
      `/app/mail/${mailboxId}?conversation=one#message`,
    );
    expect(mailDraftReturnHref(`/app/mail/${mailboxId}/automations`, mailboxId)).toBe(`/app/mail/${mailboxId}`);
    expect(mailDraftReturnHref("https://attacker.example/path", mailboxId)).toBe(`/app/mail/${mailboxId}`);
    expect(mailDraftReturnHref("http://[", mailboxId)).toBe(`/app/mail/${mailboxId}`);
  });

  test("builds canonical draft and pop-out URLs", () => {
    const mailboxId = "10000000-0000-4000-8000-000000000001";
    const draftId = "20000000-0000-4000-8000-000000000002";
    expect(mailDraftHref(mailboxId, draftId, `/app/mail/${mailboxId}?view=mine`)).toBe(
      `/app/mail/${mailboxId}/compose/${draftId}?return=%2Fapp%2Fmail%2F${mailboxId}%3Fview%3Dmine`,
    );
    expect(
      mailDraftHref(mailboxId, draftId, `/app/mail/${mailboxId}`, {
        popout: true,
      }),
    ).toContain("&window=1");
    expect(mailDraftSeedHref(mailboxId, draftId, `/app/mail/${mailboxId}?view=mine`)).toBe(
      `/app/mail/${mailboxId}/compose/local/${draftId}?return=%2Fapp%2Fmail%2F${mailboxId}%3Fview%3Dmine`,
    );
    expect(
      mailDraftSeedHref(mailboxId, draftId, `/app/mail/${mailboxId}`, {
        popout: true,
      }),
    ).toContain("&window=1");
  });

  test("registers the same-origin mailto landing route and degrades safely", () => {
    const calls: Array<[string, string | URL]> = [];
    expect(
      registerMailtoHandler(
        {
          registerProtocolHandler: (scheme, url) => calls.push([scheme, url]),
        },
        "https://cloud.example/",
      ),
    ).toEqual({ kind: "requested" });
    expect(calls).toEqual([["mailto", "https://cloud.example/app/mail/compose?mailto=%s"]]);
    expect(mailtoHandlerTemplate("https://cloud.example")).toBe("https://cloud.example/app/mail/compose?mailto=%s");
    expect(registerMailtoHandler({}, "https://cloud.example")).toEqual({
      kind: "unsupported",
    });
    expect(
      registerMailtoHandler(
        {
          registerProtocolHandler: () => {
            throw new DOMException("Denied", "SecurityError");
          },
        },
        "https://cloud.example",
      ),
    ).toEqual({ kind: "failed", message: "Denied" });
  });
});
