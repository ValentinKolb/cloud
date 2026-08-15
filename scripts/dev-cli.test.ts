import { describe, expect, test } from "bun:test";
import { findStartupFailure } from "./dev-cli";

describe("development startup diagnostics", () => {
  test("returns the latest actionable failure without a Compose prefix", () => {
    expect(findStartupFailure("app-core | booting\napp-core | error: browser build failed\napp-core | waiting")).toBe(
      "error: browser build failed",
    );
  });

  test("falls back to the latest log line", () => {
    expect(findStartupFailure("app-core | booting\napp-core | waiting")).toBe("waiting");
  });
});
