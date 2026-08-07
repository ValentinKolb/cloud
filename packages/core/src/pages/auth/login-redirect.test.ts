import { describe, expect, test } from "bun:test";
import { resolveAuthenticatedLoginRedirect } from "./login-redirect";

const loginUrl = (params = "") => `https://cloud.example/auth/login${params ? `?${params}` : ""}`;

describe("resolveAuthenticatedLoginRedirect", () => {
  test("preserves an OAuth authorization request including PKCE state", () => {
    const target =
      "/oauth/authorize?client_id=cloud-cli&response_type=code&state=opaque-state&code_challenge=opaque-challenge&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A49574%2Fcallback";

    expect(resolveAuthenticatedLoginRedirect(loginUrl(`redirectTo=${encodeURIComponent(target)}`))).toBe(target);
  });

  test("preserves local deep-link queries and fragments", () => {
    const target = "/app/mail?conversation=abc#message-42";

    expect(resolveAuthenticatedLoginRedirect(loginUrl(`redirectTo=${encodeURIComponent(target)}`))).toBe(target);
  });

  test.each([
    ["a missing target", ""],
    ["an external URL", `redirectTo=${encodeURIComponent("https://example.com/steal")}`],
    ["a protocol-relative URL", `redirectTo=${encodeURIComponent("//example.com/steal")}`],
    ["a backslash-based URL", `redirectTo=${encodeURIComponent("/\\example.com/steal")}`],
    ["a malformed encoded value", "redirectTo=%E0%A4%A"],
  ])("falls back to the home page for %s", (_case, params) => {
    expect(resolveAuthenticatedLoginRedirect(loginUrl(params))).toBe("/");
  });

  test("does not bypass a magic-link request", () => {
    const target = "/oauth/authorize?client_id=cloud-cli";

    expect(resolveAuthenticatedLoginRedirect(loginUrl(`token=magic-token&redirectTo=${encodeURIComponent(target)}`))).toBe("/");
  });

  test("does not redirect the login guard back into itself", () => {
    const target = "/auth/login?redirectTo=%2Fapp%2Fmail";

    expect(resolveAuthenticatedLoginRedirect(loginUrl(`redirectTo=${encodeURIComponent(target)}`))).toBe("/");
  });
});
