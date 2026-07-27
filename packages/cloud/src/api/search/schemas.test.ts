import { describe, expect, test } from "bun:test";
import { SearchItemSchema } from "./schemas";

const item = {
  appId: "inventory",
  appName: "Inventory",
  appIcon: "ti ti-package",
  id: "item-1",
  title: "Adapter",
};

describe("SearchItemSchema paths", () => {
  test.each(["/", "/app/inventory/items/1", "/preview?id=1"])("accepts same-origin path %s", (href) => {
    expect(SearchItemSchema.safeParse({ ...item, href }).success).toBe(true);
    expect(
      SearchItemSchema.safeParse({
        ...item,
        href: "/app/inventory",
        previewUrl: href,
      }).success,
    ).toBe(true);
  });

  test.each([
    "https://evil.example/item",
    "//evil.example/item",
    String.raw`/\evil.example/item`,
    "/\t/evil.example/item",
  ])("rejects cross-origin path %s", (href) => {
    expect(SearchItemSchema.safeParse({ ...item, href }).success).toBe(false);
    expect(
      SearchItemSchema.safeParse({
        ...item,
        href: "/app/inventory",
        previewUrl: href,
      }).success,
    ).toBe(false);
  });
});
