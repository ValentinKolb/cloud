import { expect, test } from "bun:test";
import { isSafeInlineCardImageMimeType } from "./records-display-capability";

test("Custom App Cards expose only inert raster images inline", () => {
  expect(isSafeInlineCardImageMimeType("image/png")).toBe(true);
  expect(isSafeInlineCardImageMimeType("image/webp")).toBe(true);
  expect(isSafeInlineCardImageMimeType("image/svg+xml")).toBe(false);
  expect(isSafeInlineCardImageMimeType("text/html")).toBe(false);
});
