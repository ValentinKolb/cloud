import { describe, expect, test } from "bun:test";
import { retainVisibleScannerLogs } from "./workflow-scanner-log";

describe("retainVisibleScannerLogs", () => {
  test("keeps an old active run observable after more than one hundred scans", () => {
    const entries = [
      ...Array.from({ length: 105 }, (_, index) => ({ id: `failed-${index}`, status: "failed" as const })),
      { id: "active", status: "running" as const },
    ];

    const visible = retainVisibleScannerLogs(entries, 100);
    expect(visible).toHaveLength(100);
    expect(visible.some((entry) => entry.id === "active")).toBe(true);
  });
});
