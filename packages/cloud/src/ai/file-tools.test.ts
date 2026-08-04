import { describe, expect, test } from "bun:test";
import { evaluateAiDate, evaluateAiMath } from "./file-tools";

describe("AI calculate tool", () => {
  test("evaluates arithmetic without executing code", () => {
    expect(evaluateAiMath("2 + 3 * 4")).toBe(14);
    expect(evaluateAiMath("-2 ^ 2")).toBe(-4);
    expect(evaluateAiMath("2 ^ -2")).toBe(0.25);
    expect(evaluateAiMath("round(19.99 * 1.19, 2)")).toBe(23.79);
    expect(evaluateAiMath("1234567890123 + 1")).toBe(1234567890124);
    expect(() => evaluateAiMath("sqrt(4, 9)")).toThrow("expects 1 argument");
    expect(() => evaluateAiMath("round(1.234, 1.5)")).toThrow("round digits");
    expect(() => evaluateAiMath("process.exit()")).toThrow('Unexpected character "."');
    expect(() => evaluateAiMath("1 / 0")).toThrow("not a finite number");
  });

  test("uses deterministic ISO date arithmetic and clamps month ends", () => {
    expect(evaluateAiDate("2026-01-31 + 1 month")).toBe("2026-02-28");
    expect(evaluateAiDate("2024-02-29 + 1 year")).toBe("2025-02-28");
    expect(evaluateAiDate("2026-03-01 - 2 weeks")).toBe("2026-02-15");
    expect(() => evaluateAiDate("03/01/2026 + 1 day")).toThrow("ISO date");
  });
});
