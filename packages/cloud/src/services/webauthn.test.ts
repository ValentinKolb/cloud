import { describe, expect, test } from "bun:test";
import { resolveWebAuthnRp } from "./webauthn";

describe("resolveWebAuthnRp", () => {
  test("derives rp id and origin from https app url", () => {
    expect(resolveWebAuthnRp({ appUrl: "https://cloud.example/app", appName: "Cloud" })).toEqual({
      rpName: "Cloud",
      rpID: "cloud.example",
      origin: "https://cloud.example",
    });
  });

  test("accepts localhost over http for development", () => {
    expect(resolveWebAuthnRp({ appUrl: "http://localhost:3000", appName: "" })).toEqual({
      rpName: "Cloud",
      rpID: "localhost",
      origin: "http://localhost:3000",
    });
    expect(resolveWebAuthnRp({ appUrl: "localhost:3000", appName: "Cloud" })).toEqual({
      rpName: "Cloud",
      rpID: "localhost",
      origin: "http://localhost:3000",
    });
    expect(resolveWebAuthnRp({ appUrl: "http://[::1]:3000", appName: "Cloud" })).toEqual({
      rpName: "Cloud",
      rpID: "[::1]",
      origin: "http://[::1]:3000",
    });
  });

  test("rejects non-local insecure origins", () => {
    expect(() => resolveWebAuthnRp({ appUrl: "http://cloud.example", appName: "Cloud" })).toThrow(
      "WebAuthn requires an HTTPS app.url",
    );
  });
});
