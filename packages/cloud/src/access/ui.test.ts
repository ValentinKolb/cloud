import { describe, expect, test } from "bun:test";
import packageJson from "../../package.json";

describe("focused access UI boundary", () => {
  test("is exposed as a focused package subpath", () => {
    expect(packageJson.exports["./access/ui"]).toBe("./src/access/ui.ts");
  });
});
