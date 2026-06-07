import { test, expect, describe } from "bun:test";
import { formulaHandler } from "./formula";

// =============================================================================
// formulaHandler.configSchema — the save-time gate that catches typos.
// Formula values are computed at read time; there is no direct value validator.
// =============================================================================

const parse = (config: unknown) => formulaHandler.configSchema.safeParse(config);

describe("formulaHandler config", () => {
  test("is a computed field kind", () => {
    expect(formulaHandler.kind).toBe("computed");
  });

  test("accepts an empty config (field created before expression typed)", () => {
    const r = parse({});
    expect(r.success).toBe(true);
  });

  test("accepts an undefined expression", () => {
    const r = parse({ expression: undefined });
    expect(r.success).toBe(true);
  });

  test("accepts a whitespace-only expression as not-yet-set", () => {
    // The superRefine trims before parsing, so blank input is treated as
    // 'no expression yet' rather than a parse error.
    const r = parse({ expression: "   " });
    expect(r.success).toBe(true);
  });

  test("accepts a valid expression with only literals", () => {
    const r = parse({ expression: "1 + 2" });
    expect(r.success).toBe(true);
  });

  test("accepts a valid expression with a #slug reference", () => {
    const r = parse({ expression: "#aB3kQ * 1.19" });
    expect(r.success).toBe(true);
  });

  test("preserves a display format", () => {
    const format = { kind: "barcode", bcid: "code128", showText: true };
    const r = parse({ expression: "#aB3kQ", format });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as { format?: unknown }).format).toEqual(format);
  });

  test("rejects an unparseable expression with a useful error path", () => {
    const r = parse({ expression: "1 +" });
    expect(r.success).toBe(false);
    if (!r.success) {
      // The custom issue is attached to `expression` so the field editor
      // can highlight the right input.
      expect(r.error.issues[0]?.path).toEqual(["expression"]);
      expect(r.error.issues[0]?.message).toMatch(/parse error/i);
    }
  });

  test("rejects an unclosed string literal", () => {
    const r = parse({ expression: 'CONCAT("hi)' });
    expect(r.success).toBe(false);
  });

  test("rejects an unclosed paren", () => {
    const r = parse({ expression: "(1 + 2" });
    expect(r.success).toBe(false);
  });

  test("rejects a bare `#` (empty slug)", () => {
    const r = parse({ expression: "# + 1" });
    expect(r.success).toBe(false);
  });
});
