import { expect, test } from "bun:test";
import { buildSpaceCalendarUid, buildSpaceItemHref } from "./routes";

test("builds the canonical Spaces item route", () => {
  expect(buildSpaceItemHref("Space1", "Item01")).toBe("/app/spaces/Space1?item=Item01");
});

test("builds one canonical calendar identity for every producer", () => {
  expect(buildSpaceCalendarUid("Item01")).toBe("Item01@spaces.cloud");
});
