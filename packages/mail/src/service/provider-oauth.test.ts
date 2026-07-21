import { describe, expect, test } from "bun:test";
import { mailOAuthStartInputSchema } from "../contracts";
import { transportDiagnostic } from "./connectors/imap-smtp";
import { createPkceMaterial } from "./provider-oauth";
import { validateOAuthEndpoint } from "./provider-oauth-http";
import { OAUTH_PROVIDER_DECLARATIONS } from "./provider-oauth-providers";
import { parseOAuthTokenResponse } from "./provider-oauth-tokens";

describe("Mail provider OAuth", () => {
  test("creates high-entropy PKCE S256 material without padding", () => {
    const first = createPkceMaterial();
    const second = createPkceMaterial();
    expect(first.state).not.toBe(second.state);
    expect(first.browserNonce).not.toBe(second.browserNonce);
    expect(first.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(first.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.codeChallenge).not.toContain("=");
  });

  test("declares only fixed Google and Microsoft HTTPS endpoints", () => {
    expect(Object.keys(OAUTH_PROVIDER_DECLARATIONS).sort()).toEqual(["google", "microsoft"]);
    for (const declaration of Object.values(OAUTH_PROVIDER_DECLARATIONS)) {
      expect(validateOAuthEndpoint(declaration.authorizationEndpoint).protocol).toBe("https:");
      expect(validateOAuthEndpoint(declaration.tokenEndpoint).protocol).toBe("https:");
    }
    expect(OAUTH_PROVIDER_DECLARATIONS.google.scopes).toContain("https://mail.google.com/");
    expect(OAUTH_PROVIDER_DECLARATIONS.microsoft.scopes).toContain("https://outlook.office.com/IMAP.AccessAsUser.All");
    expect(OAUTH_PROVIDER_DECLARATIONS.microsoft.scopes).toContain("https://outlook.office.com/SMTP.Send");
  });

  test("accepts edited connection details for OAuth replacement and keeps simple reconnects", () => {
    const base = {
      operation: "reconnect" as const,
      providerId: "google" as const,
      connectionId: "11111111-1111-4111-8111-111111111111",
    };
    expect(mailOAuthStartInputSchema.safeParse(base).success).toBe(true);
    expect(
      mailOAuthStartInputSchema.safeParse({
        ...base,
        connection: {
          name: "Work Mail",
          email: "user@example.com",
          username: "user@example.com",
          imap: { host: "imap.example.com", port: 993, tlsMode: "implicit" },
          smtp: { host: "smtp.example.com", port: 587, tlsMode: "starttls" },
        },
      }).success,
    ).toBe(true);
  });

  test("rejects unsafe OAuth endpoints", () => {
    for (const endpoint of [
      "http://oauth.example.com/token",
      "https://user:pass@oauth.example.com/token",
      "https://oauth.example.com/token#fragment",
      "https://oauth.example.com:8443/token",
    ]) {
      expect(() => validateOAuthEndpoint(endpoint)).toThrow();
    }
  });

  test("retains or rotates refresh tokens without exposing provider extras", () => {
    const retained = parseOAuthTokenResponse({ access_token: "new-access", expires_in: 3600, token_type: "Bearer" }, "old-refresh", 0);
    expect(retained).toEqual({ accessToken: "new-access", refreshToken: "old-refresh", expiresAt: "1970-01-01T01:00:00.000Z" });
    const rotated = parseOAuthTokenResponse(
      { access_token: "newer-access", refresh_token: "new-refresh", expires_in: 60, token_type: "bearer", ignored: "secret" },
      "old-refresh",
      0,
    );
    expect(rotated).toEqual({ accessToken: "newer-access", refreshToken: "new-refresh", expiresAt: "1970-01-01T00:01:00.000Z" });
  });

  test("bounds token response values and requires bearer tokens", () => {
    expect(() => parseOAuthTokenResponse({ access_token: "token", expires_in: 0 })).toThrow();
    expect(() => parseOAuthTokenResponse({ access_token: "token", expires_in: 60, token_type: "mac" })).toThrow();
    expect(() => parseOAuthTokenResponse({ access_token: "x".repeat(65_537), expires_in: 60 })).toThrow();
  });

  test("sanitizes transport failures without returning provider text", () => {
    expect(
      transportDiagnostic({ status: "rejected", reason: Object.assign(new Error("535 secret account rejected"), { code: "EAUTH" }) }),
    ).toEqual({
      status: "failed",
      category: "authentication",
      message: "Authentication failed",
    });
  });
});
