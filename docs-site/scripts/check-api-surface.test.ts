import { expect, test } from "bun:test";
import { packageSpecifier, undocumentedExports } from "./check-api-surface";

test("maps and checks package export specifiers", () => {
  expect(packageSpecifier("@scope/pkg", ".")).toBe("@scope/pkg");
  expect(packageSpecifier("@scope/pkg", "./server")).toBe("@scope/pkg/server");
  expect(undocumentedExports("@scope/pkg", { ".": "./index.ts", "./server": "./server.ts" }, "Use `@scope/pkg`.")).toEqual([
    "@scope/pkg/server",
  ]);
});
