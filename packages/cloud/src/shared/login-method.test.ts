import { describe, expect, test } from "bun:test";
import { readLoginMethodFromCookieHeader, resolveLoginFallbackMethod } from "./login-method";

describe("login method preference", () => {
  test("reads the last valid login method cookie", () => {
    expect(readLoginMethodFromCookieHeader("login_method=email")).toBe("email");
    expect(readLoginMethodFromCookieHeader("theme=dark; login_method=ipa; other=1")).toBe("ipa");
    expect(readLoginMethodFromCookieHeader("login_method=broken; login_method=ipa")).toBe("ipa");
    expect(readLoginMethodFromCookieHeader("login_method=ipa; login_method=broken")).toBe("ipa");
  });

  test("ignores missing and invalid cookies", () => {
    expect(readLoginMethodFromCookieHeader(null)).toBeNull();
    expect(readLoginMethodFromCookieHeader("theme=dark")).toBeNull();
    expect(readLoginMethodFromCookieHeader("login_method=broken")).toBeNull();
  });

  test("uses remembered FreeIPA login as fallback when allowed", () => {
    expect(
      resolveLoginFallbackMethod({
        freeIpaEnabled: true,
        hasToken: false,
        isGuestHidden: false,
        queryMethod: undefined,
        persistedMethod: "ipa",
      }),
    ).toBe("ipa");
  });

  test("keeps explicit and forced choices ahead of the cookie", () => {
    expect(
      resolveLoginFallbackMethod({
        freeIpaEnabled: true,
        hasToken: true,
        isGuestHidden: false,
        queryMethod: undefined,
        persistedMethod: "ipa",
      }),
    ).toBe("email");
    expect(
      resolveLoginFallbackMethod({
        freeIpaEnabled: true,
        hasToken: false,
        isGuestHidden: true,
        queryMethod: "email",
        persistedMethod: "email",
      }),
    ).toBe("ipa");
    expect(
      resolveLoginFallbackMethod({
        freeIpaEnabled: true,
        hasToken: false,
        isGuestHidden: false,
        queryMethod: "email",
        persistedMethod: "ipa",
      }),
    ).toBe("email");
  });

  test("does not turn passkey into a fallback tab", () => {
    expect(
      resolveLoginFallbackMethod({
        freeIpaEnabled: true,
        hasToken: false,
        isGuestHidden: false,
        queryMethod: undefined,
        persistedMethod: "passkey",
      }),
    ).toBe("email");
  });
});
