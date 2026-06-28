import { describe, expect, test } from "bun:test";
import { MAX_AVATAR_BYTES, MAX_AVATAR_DATA_URL_LENGTH, parseAvatarDataUrl } from "./avatar";

const dataUrl = (type: "png" | "jpeg" | "webp", bytes: number[]) => `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`;

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xdb, 0x00];
const WEBP_BYTES = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00];

describe("parseAvatarDataUrl", () => {
  test("accepts png, jpeg, and webp data URLs with matching magic bytes", () => {
    const cases = [
      { input: dataUrl("png", PNG_BYTES), contentType: "image/png" },
      { input: dataUrl("jpeg", JPEG_BYTES), contentType: "image/jpeg" },
      { input: dataUrl("webp", WEBP_BYTES), contentType: "image/webp" },
    ] as const;

    for (const entry of cases) {
      const result = parseAvatarDataUrl(` ${entry.input} `);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.dataUrl).toBe(entry.input);
      expect(result.data.contentType).toBe(entry.contentType);
      expect(result.data.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.data.bytes.length).toBeGreaterThan(0);
    }
  });

  test("rejects unsupported image types and malformed base64", () => {
    expect(parseAvatarDataUrl("data:image/svg+xml;base64,PHN2Zy8+").ok).toBe(false);
    expect(parseAvatarDataUrl("data:image/gif;base64,R0lGODlh").ok).toBe(false);
    expect(parseAvatarDataUrl("data:image/png;base64,ab==").ok).toBe(false);
  });

  test("rejects payloads whose bytes do not match the declared type", () => {
    const result = parseAvatarDataUrl(dataUrl("png", JPEG_BYTES));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected avatar parsing to fail");
    expect(result.error).toContain("declared type");
  });

  test("rejects oversized avatar payloads", () => {
    const oversizedBytes = Buffer.concat([Buffer.from(PNG_BYTES), Buffer.alloc(MAX_AVATAR_BYTES)]);
    const result = parseAvatarDataUrl(`data:image/png;base64,${oversizedBytes.toString("base64")}`);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected avatar parsing to fail");
    expect(result.error).toContain("too large");
  });

  test("rejects oversized data URLs before decoding", () => {
    const result = parseAvatarDataUrl(`data:image/png;base64,${"A".repeat(MAX_AVATAR_DATA_URL_LENGTH)}`);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected avatar parsing to fail");
    expect(result.error).toContain("too large");
  });
});
