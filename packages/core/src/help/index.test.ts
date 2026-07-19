import { describe, expect, test } from "bun:test";
import { coreHelp } from ".";

describe("coreHelp", () => {
  test("serves the existing Core help topics as Markdown", async () => {
    expect(coreHelp.manifest.map((document) => document.id)).toEqual([
      "core-start",
      "core-profile",
      "core-security",
      "core-notifications",
      "core-admin",
    ]);

    const startResponse = await coreHelp.router.request("/core-start");
    const startPayload = await startResponse.json();
    expect(startResponse.status).toBe(200);
    expect(startPayload.markdown).toContain("Core owns platform-level pages and services");

    const securityResponse = await coreHelp.router.request("/core-security");
    const securityPayload = await securityResponse.json();
    expect(securityPayload.markdown).toContain("The available sign-in methods depend");

    const notificationsResponse = await coreHelp.router.request("/core-notifications");
    const notificationsPayload = await notificationsResponse.json();
    expect(notificationsPayload.markdown).toContain("Notifications keep account and app events");

    const adminResponse = await coreHelp.router.request("/core-admin");
    const adminPayload = await adminResponse.json();
    expect(adminPayload.markdown).toContain("Core admin pages configure platform services");
  });
});
