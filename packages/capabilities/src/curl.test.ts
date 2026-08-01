import { describe, expect, test } from "bun:test";
import { buildCapabilityCurl, quotePosix } from "./curl";

describe("capability cURL", () => {
  test("quotes shell values without embedding a credential", () => {
    expect(quotePosix("it's safe")).toBe("'it'\"'\"'s safe'");
    const command = buildCapabilityCurl({
      kind: "action",
      appId: "contacts",
      capabilityId: "contact.create",
      body: { name: "O'Brien", note: "line one\nline two" },
      idempotencyKey: "attempt-123",
    });

    expect(command).toContain("$CLD_SERVER/api/capabilities/v1/actions/contacts/contact.create");
    expect(command).toContain("Authorization: Bearer $CLD_TOKEN");
    expect(command).toContain("Idempotency-Key: attempt-123");
    expect(command).toContain("O'\"'\"'Brien");
    expect(command).not.toContain("Cookie:");
  });

  test("omits idempotency when the capability does not require it", () => {
    const command = buildCapabilityCurl({ kind: "query", appId: "contacts", capabilityId: "contact.list", body: {} });
    expect(command).toContain("/queries/");
    expect(command).not.toContain("Idempotency-Key");
  });
});
