import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import { oauthTokens } from "@valentinkolb/cloud/services";
import { generateSpecs } from "hono-openapi";
import { conversationContext, publicResources } from "../service";
import app from ".";

const base = "/mailboxes/{mailboxId}/conversations/{conversationId}";
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  uid: "related-mail-test",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Related",
  sn: "Mail",
  displayName: "Related Mail",
  mail: "related-mail@example.test",
  avatarHash: null,
  ipa: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
} satisfies User;

afterEach(() => mock.restore());

describe("Mail conversation context OpenAPI contract", () => {
  test("publishes authenticated Contacts context and history routes", async () => {
    const spec = await generateSpecs(app);
    const history = spec.paths?.[`${base}/contacts/{bookId}/{contactId}/history`]?.get;
    const operations = [spec.paths?.[`${base}/context`]?.get, history];

    expect(operations.every((operation) => operation?.tags?.includes("Mail:Context"))).toBe(true);
    expect(operations.every((operation) => operation?.security?.length === 1)).toBe(true);
    expect(operations.every((operation) => operation?.responses?.["200"])).toBe(true);
    expect(history?.responses?.["503"]).toBeDefined();
  });

  test("returns the structured Contacts dependency failure from the public route", async () => {
    spyOn(oauthTokens, "verifyAccessToken").mockResolvedValue({ kind: "user", payload: {}, user, scopes: [] });
    spyOn(conversationContext, "listRelatedMail").mockResolvedValue({
      ok: false,
      code: "INVALID_APP_RESPONSE",
      message: "Contacts returned an invalid response",
      status: 503,
    });
    spyOn(publicResources, "resolvePublicId").mockResolvedValue("22222222-2222-4222-8222-222222222222");
    spyOn(publicResources, "resolveMailboxPublicId").mockResolvedValue("33333333-3333-4333-8333-333333333333");

    const response = await app.request("/mailboxes/mbx123/conversations/cnv123/contacts/system/cnt123/history", {
      headers: { authorization: "Bearer related-mail-test" },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "INVALID_APP_RESPONSE",
      message: "Contacts returned an invalid response",
    });
  });

  test("rejects legacy UUID resource URLs", async () => {
    spyOn(oauthTokens, "verifyAccessToken").mockResolvedValue({ kind: "user", payload: {}, user, scopes: [] });
    const relatedMail = spyOn(conversationContext, "listRelatedMail");

    const response = await app.request(
      "/mailboxes/22222222-2222-4222-8222-222222222222/conversations/33333333-3333-4333-8333-333333333333/contacts/system/44444444-4444-4444-8444-444444444444/history",
      { headers: { authorization: "Bearer related-mail-test" } },
    );

    expect(response.status).toBe(404);
    expect(relatedMail).not.toHaveBeenCalled();
  });
});
