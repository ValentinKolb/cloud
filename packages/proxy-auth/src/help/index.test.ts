import { describe, expect, test } from "bun:test";
import { proxyAuthHelp } from ".";

describe("proxyAuthHelp", () => {
  test("serves the existing Proxy Auth help as Markdown", async () => {
    expect(proxyAuthHelp.manifest.map((document) => document.id)).toEqual(["proxy-auth-start"]);

    const response = await proxyAuthHelp.router.request("/proxy-auth-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Proxy Auth lets admins protect external services");
    expect(payload.markdown).toContain("returns 403 for authenticated users");
  });
});
