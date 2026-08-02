import { describe, expect, test } from "bun:test";
import { proxyAuthHelp } from ".";

describe("proxyAuthHelp", () => {
  test("owns the existing Proxy Auth help as Markdown", () => {
    expect(proxyAuthHelp.documents.map((document) => document.id)).toEqual([
      "proxy-auth-start",
      "proxy-auth-setup",
      "proxy-auth-troubleshooting",
    ]);

    expect(proxyAuthHelp.getMarkdown("proxy-auth-start")).toContain("Proxy Auth lets admins protect external services");
    expect(proxyAuthHelp.getMarkdown("proxy-auth-start")).toContain("returns 403 for authenticated users");
    expect(proxyAuthHelp.getMarkdown("proxy-auth-setup")).toContain("Create a Proxy Auth client");
    expect(proxyAuthHelp.getMarkdown("proxy-auth-troubleshooting")).toContain("A successful Cloud login proves");
  });
});
