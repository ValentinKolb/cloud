import { describe, expect, test } from "bun:test";
import { barrelTargetError, isBarrelTarget } from "./migration-inventory-contract";

describe("migration inventory target contract", () => {
  test("rejects group barrels regardless of their catalog group", () => {
    expect(isBarrelTarget("src/layout/index.ts")).toBe(true);
    expect(isBarrelTarget("src/future-group/index.tsx")).toBe(true);
    expect(barrelTargetError("src/future-group/index.ts")).toContain("concrete module");
  });

  test("allows only explicitly declared intentional module barrels", () => {
    expect(barrelTargetError("src/inputs/completion/index.ts", true)).toBeUndefined();
    expect(barrelTargetError("src/inputs/Select.tsx", true)).toContain("only valid");
  });
});
