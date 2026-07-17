import { describe, expect, test } from "bun:test";
import { oauthHelp } from ".";

describe("oauthHelp", () => {
  test("serves the existing OAuth help as Markdown", async () => {
    expect(oauthHelp.manifest.map((document) => document.id)).toEqual(["oauth-start"]);

    const response = await oauthHelp.router.request("/oauth-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("OAuth lets admins register external applications");
    expect(payload.markdown).toContain("The `oauth` CLI can list");
  });
});
