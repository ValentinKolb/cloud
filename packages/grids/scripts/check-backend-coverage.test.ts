import { describe, expect, test } from "bun:test";
import { coveragePercent, isCriticalBackendSource, parseBackendCoverage } from "./check-backend-coverage";

describe("backend coverage gate", () => {
  test("includes critical backend modules but not frontend or test files", () => {
    expect(isCriticalBackendSource("/repo/packages/grids/src/api/tables.ts")).toBe(true);
    expect(isCriticalBackendSource("/repo/packages/grids/src/ws.ts")).toBe(true);
    expect(isCriticalBackendSource("/repo/packages/grids/src/frontend/page.tsx")).toBe(false);
    expect(isCriticalBackendSource("/repo/packages/grids/src/service/records.test.ts")).toBe(false);
    expect(isCriticalBackendSource("/repo/packages/grids/src/service/records.integration.test.ts")).toBe(false);
  });

  test("aggregates LCOV summary counters only for critical sources", () => {
    const totals = parseBackendCoverage(`
SF:/repo/packages/grids/src/api/tables.ts
FNF:4
FNH:3
LF:10
LH:8
end_of_record
SF:/repo/packages/grids/src/frontend/page.tsx
FNF:10
FNH:0
LF:100
LH:0
end_of_record
SF:/repo/packages/grids/src/service/records.ts
FNF:2
FNH:2
LF:5
LH:5
end_of_record
`);

    expect(totals).toEqual({
      functions: { found: 6, hit: 5 },
      lines: { found: 15, hit: 13 },
    });
    expect(coveragePercent(totals.lines)).toBeCloseTo(86.67, 2);
  });

  test("keeps an empty report distinguishable from measured coverage", () => {
    expect(parseBackendCoverage("")).toEqual({
      functions: { found: 0, hit: 0 },
      lines: { found: 0, hit: 0 },
    });
  });
});
