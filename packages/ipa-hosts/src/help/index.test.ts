import { describe, expect, test } from "bun:test";
import { ipaHostsHelp } from ".";

describe("ipaHostsHelp", () => {
  test("serves the existing Hosts help as Markdown", async () => {
    expect(ipaHostsHelp.manifest.map((document) => document.id)).toEqual(["ipa-hosts-start"]);

    const response = await ipaHostsHelp.router.request("/ipa-hosts-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Hosts shows a local mirror of FreeIPA hosts");
    expect(payload.markdown).toContain("The `ipa-hosts` CLI uses the same admin API");
  });
});
