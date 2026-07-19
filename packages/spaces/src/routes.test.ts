import { expect, test } from "bun:test";
import { buildSpaceItemHref } from "./routes";

test("builds the canonical Spaces item route", () => {
  expect(buildSpaceItemHref("865c713f-4f1c-43a1-a5e7-35e8e70eaec5", "02ef2502-8be5-4b98-9347-3146e4bae04d")).toBe(
    "/app/spaces/865c713f-4f1c-43a1-a5e7-35e8e70eaec5?item=02ef2502-8be5-4b98-9347-3146e4bae04d",
  );
});
