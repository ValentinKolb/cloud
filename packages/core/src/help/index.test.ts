import { describe, expect, test } from "bun:test";
import { coreHelp } from ".";

describe("coreHelp", () => {
  test("serves the existing Core help topics as Markdown", async () => {
    expect(coreHelp.manifest.map((document) => document.id)).toEqual(["core-start", "core-profile", "core-admin"]);

    const startResponse = await coreHelp.router.request("/core-start");
    const startPayload = await startResponse.json();
    expect(startResponse.status).toBe(200);
    expect(startPayload.markdown).toContain("Core owns platform-level pages and services");

    const adminResponse = await coreHelp.router.request("/core-admin");
    const adminPayload = await adminResponse.json();
    expect(adminPayload.markdown).toContain("Core admin pages configure platform services");
  });
});
