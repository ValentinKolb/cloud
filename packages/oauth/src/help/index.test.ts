import { describe, expect, test } from "bun:test";
import { oauthHelp } from ".";

describe("oauthHelp", () => {
  test("serves the existing OAuth help as Markdown", async () => {
    expect(oauthHelp.manifest.map((document) => document.id)).toEqual([
      "oauth-start",
      "oauth-integration",
      "oauth-troubleshooting",
    ]);

    const response = await oauthHelp.router.request("/oauth-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("OAuth lets admins register external applications");
    expect(payload.markdown).toContain("The `oauth` CLI can list");

    const integrationResponse = await oauthHelp.router.request("/oauth-integration");
    const integrationPayload = await integrationResponse.json();
    expect(integrationPayload.markdown).toContain("Create one OAuth client per external application");

    const troubleshootingResponse = await oauthHelp.router.request("/oauth-troubleshooting");
    const troubleshootingPayload = await troubleshootingResponse.json();
    expect(troubleshootingPayload.markdown).toContain("Compare the complete URL");
  });
});
