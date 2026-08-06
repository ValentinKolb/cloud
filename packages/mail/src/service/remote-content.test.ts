import { describe, expect, test } from "bun:test";
import { matchesRemoteImageSignature, normalizeRemoteContentRule } from "./remote-content";

describe("remote content rules", () => {
  test("normalizes sender and internationalized domain rules", () => {
    expect(normalizeRemoteContentRule({ scope: "sender", value: " Sender@Exämple.de " })).toEqual({
      ok: true,
      data: { scope: "sender", value: "sender@xn--exmple-cua.de" },
    });
    expect(normalizeRemoteContentRule({ scope: "domain", value: "Exämple.de." })).toEqual({
      ok: true,
      data: { scope: "domain", value: "xn--exmple-cua.de" },
    });
  });

  test("rejects malformed rules", () => {
    expect(normalizeRemoteContentRule({ scope: "sender", value: "not-an-address" }).ok).toBeFalse();
    expect(normalizeRemoteContentRule({ scope: "domain", value: "https://example.com" }).ok).toBeFalse();
    expect(normalizeRemoteContentRule({ scope: "domain", value: "localhost" }).ok).toBeTrue();
  });
});

describe("remote image signatures", () => {
  test("accepts supported raster signatures and rejects mismatches", () => {
    expect(matchesRemoteImageSignature("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff]))).toBeTrue();
    expect(matchesRemoteImageSignature("image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeTrue();
    expect(matchesRemoteImageSignature("image/gif", new TextEncoder().encode("GIF89a"))).toBeTrue();
    expect(matchesRemoteImageSignature("image/webp", new TextEncoder().encode("RIFF0000WEBP"))).toBeTrue();
    expect(matchesRemoteImageSignature("image/avif", new TextEncoder().encode("0000ftypavif"))).toBeTrue();
    expect(matchesRemoteImageSignature("image/png", new TextEncoder().encode("<svg>"))).toBeFalse();
  });
});
