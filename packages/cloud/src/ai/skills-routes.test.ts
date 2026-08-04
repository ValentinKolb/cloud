import { describe, expect, test } from "bun:test";
import { decodeAiFileContent } from "./files-store";
import { canMutateAiSkillInUserRoutes } from "./skills-routes";
import type { AiSkill } from "./skills-store";

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

describe("AI skill route ownership", () => {
  const skill = (scope: "personal" | "workspace", ownerUserId: string | null): AiSkill => ({
    id: "11111111-1111-4111-8111-111111111111",
    name: "Meeting summary",
    description: "Summarize meetings",
    instructions: "List decisions first.",
    scope,
    ownerUserId,
    enabled: true,
    revision: 1,
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
  });

  test("user routes mutate only personal skills owned by that user", () => {
    expect(canMutateAiSkillInUserRoutes(skill("personal", "user-1"), "user-1")).toBe(true);
    expect(canMutateAiSkillInUserRoutes(skill("personal", "user-1"), "user-2")).toBe(false);
    expect(canMutateAiSkillInUserRoutes(skill("workspace", null), "user-1")).toBe(false);
  });
});
