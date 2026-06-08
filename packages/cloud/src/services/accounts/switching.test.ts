import { describe, expect, test } from "bun:test";
import { resolveIpaTransitionProfile } from "./switching";

describe("resolveIpaTransitionProfile", () => {
  test("keeps the current profile for demote_to_local", () => {
    expect(resolveIpaTransitionProfile({ currentProfile: "user", policy: "demote_to_local" })).toBe("user");
    expect(resolveIpaTransitionProfile({ currentProfile: "guest", policy: "demote_to_local" })).toBe("guest");
  });

  test("supports explicit local user and guest transition policies", () => {
    expect(resolveIpaTransitionProfile({ currentProfile: "guest", policy: "demote_to_local_user" })).toBe("user");
    expect(resolveIpaTransitionProfile({ currentProfile: "user", policy: "demote_to_local_guest" })).toBe("guest");
  });
});
