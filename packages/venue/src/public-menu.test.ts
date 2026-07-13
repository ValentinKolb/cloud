import { describe, expect, test } from "bun:test";
import type { PublicSection } from "./contracts";
import { filterPublicMenuSections, isPublicMenuItemAvailable } from "./public-menu";

const item = (availability: { availableFrom?: string | null; availableUntil?: string | null } = {}) => ({
  name: "Lunch special",
  ...availability,
});

const menuSection = (items: unknown[]): PublicSection => ({
  id: "section-1",
  venueId: "venue-1",
  kind: "menu",
  title: "Menu",
  content: { items },
  enabled: true,
  position: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
});

describe("public menu availability", () => {
  test("treats start and end dates as inclusive", () => {
    const scheduled = item({ availableFrom: "2026-07-13", availableUntil: "2026-07-15" });

    expect(isPublicMenuItemAvailable(scheduled, "2026-07-12")).toBe(false);
    expect(isPublicMenuItemAvailable(scheduled, "2026-07-13")).toBe(true);
    expect(isPublicMenuItemAvailable(scheduled, "2026-07-15")).toBe(true);
    expect(isPublicMenuItemAvailable(scheduled, "2026-07-16")).toBe(false);
  });

  test("supports one-sided and unlimited availability", () => {
    expect(isPublicMenuItemAvailable(item(), "2026-07-13")).toBe(true);
    expect(isPublicMenuItemAvailable(item({ availableFrom: "2026-07-14" }), "2026-07-13")).toBe(false);
    expect(isPublicMenuItemAvailable(item({ availableUntil: "2026-07-12" }), "2026-07-13")).toBe(false);
  });

  test("filters only public menu item copies and fails closed for malformed schedules", () => {
    const original = menuSection([item(), item({ availableFrom: "2026-07-14" }), { name: "Broken", availableFrom: "tomorrow" }]);
    const [filtered] = filterPublicMenuSections([original], "2026-07-13");

    expect(filtered?.content.items).toEqual([item()]);
    expect(original.content.items).toHaveLength(3);
  });

  test("hides a public menu section while none of its items are available", () => {
    const sections = filterPublicMenuSections([menuSection([item({ availableFrom: "2026-07-14" })])], "2026-07-13");

    expect(sections).toEqual([]);
  });
});
