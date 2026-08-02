import { describe, expect, test } from "bun:test";
import { ipaHostsHelp } from ".";

describe("ipaHostsHelp", () => {
  test("owns the existing Hosts help as Markdown", () => {
    expect(ipaHostsHelp.documents.map((document) => document.id)).toEqual(["ipa-hosts-start", "ipa-hosts-troubleshooting"]);

    expect(ipaHostsHelp.getMarkdown("ipa-hosts-start")).toContain("Hosts shows a local mirror of FreeIPA hosts");
    expect(ipaHostsHelp.getMarkdown("ipa-hosts-start")).toContain("The `ipa-hosts` CLI uses the same admin API");
    expect(ipaHostsHelp.getMarkdown("ipa-hosts-troubleshooting")).toContain("FreeIPA remains the source of truth");
  });
});
