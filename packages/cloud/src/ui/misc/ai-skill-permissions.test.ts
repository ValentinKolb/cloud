import { describe, expect, test } from "bun:test";
import { canEditAiSkillInSurface } from "./ai-skill-permissions";

describe("AI skill surface permissions", () => {
  test("keeps workspace skills read-only outside the admin surface", () => {
    expect(canEditAiSkillInSurface({ canManage: true, isAdminSurface: false, ownerUserId: null })).toBe(false);
  });

  test("allows workspace management only on the admin surface", () => {
    expect(canEditAiSkillInSurface({ canManage: true, isAdminSurface: true, ownerUserId: null })).toBe(true);
  });

  test("allows owners to edit personal skills in the Assistant", () => {
    expect(canEditAiSkillInSurface({ canManage: true, isAdminSurface: false, ownerUserId: "user-1" })).toBe(true);
    expect(canEditAiSkillInSurface({ canManage: false, isAdminSurface: false, ownerUserId: "user-1" })).toBe(false);
  });
});
