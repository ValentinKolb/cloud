import { describe, expect, test } from "bun:test";
import { proxyAuthHelp } from ".";

describe("proxyAuthHelp", () => {
  test("serves the existing Proxy Auth help as Markdown", async () => {
    expect(proxyAuthHelp.manifest.map((document) => document.id)).toEqual([
      "proxy-auth-start",
      "proxy-auth-setup",
      "proxy-auth-troubleshooting",
    ]);

    const response = await proxyAuthHelp.router.request("/proxy-auth-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Proxy Auth lets admins protect external services");
    expect(payload.markdown).toContain("returns 403 for authenticated users");

    const setupResponse = await proxyAuthHelp.router.request("/proxy-auth-setup");
    const setupPayload = await setupResponse.json();
    expect(setupPayload.markdown).toContain("Create a Proxy Auth client");

    const troubleshootingResponse = await proxyAuthHelp.router.request("/proxy-auth-troubleshooting");
    const troubleshootingPayload = await troubleshootingResponse.json();
    expect(troubleshootingPayload.markdown).toContain("A successful Cloud login proves");
  });
});
