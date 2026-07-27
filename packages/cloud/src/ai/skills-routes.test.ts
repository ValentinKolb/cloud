import { describe, expect, test } from "bun:test";
import { decodeAiFileContent } from "./files-store";

describe("AI file decoding", () => {
  test("decodes canonical base64 and UTF-8 content", () => {
    expect(new TextDecoder().decode(decodeAiFileContent("aGVsbG8=", "base64"))).toBe("hello");
    expect(new TextDecoder().decode(decodeAiFileContent("hello", "utf8"))).toBe("hello");
  });

  test("rejects malformed or non-canonical base64", () => {
    expect(() => decodeAiFileContent("not base64", "base64")).toThrow("Invalid base64 file content.");
    expect(() => decodeAiFileContent("aGVsbG8", "base64")).toThrow("Invalid base64 file content.");
  });
});
