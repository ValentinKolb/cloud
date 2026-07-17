import { describe, expect, test } from "bun:test";
import { accountsHelp } from ".";

describe("accountsHelp", () => {
  test("serves the existing Accounts help topics as Markdown", async () => {
    expect(accountsHelp.manifest.map((document) => document.id)).toEqual(["accounts-start", "accounts-admin", "accounts-cli"]);

    const startResponse = await accountsHelp.router.request("/accounts-start");
    const startPayload = await startResponse.json();
    expect(startResponse.status).toBe(200);
    expect(startPayload.markdown).toContain("Accounts shows your own account context");

    const adminResponse = await accountsHelp.router.request("/accounts-admin");
    const adminPayload = await adminResponse.json();
    expect(adminPayload.markdown).toContain("Admin pages are server-rendered lists");

    const cliResponse = await accountsHelp.router.request("/accounts-cli");
    const cliPayload = await cliResponse.json();
    expect(cliPayload.markdown).toContain("The Accounts CLI uses the same");
  });
});
