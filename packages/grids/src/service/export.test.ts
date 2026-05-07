import { test, expect, describe } from "bun:test";
import { csvQuote, formatCellForExport } from "./export";
import type { Field } from "./types";

const mkField = (overrides: Partial<Field> & Pick<Field, "id" | "type">): Field => ({
  slug: overrides.id.slice(0, 5),
  tableId: "00000000-0000-0000-0000-000000000000",
  name: overrides.id,
  description: null,
  config: {},
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

// =============================================================================
// csvQuote — RFC 4180 quoting. Plain text passes through; cells with
// commas, quotes, CR, or LF get wrapped + internal quotes doubled.
// =============================================================================

describe("csvQuote", () => {
  test("plain ASCII without specials passes through", () => {
    expect(csvQuote("hello")).toBe("hello");
  });
  test("empty string passes through", () => {
    expect(csvQuote("")).toBe("");
  });
  test("comma triggers wrap", () => {
    expect(csvQuote("a,b")).toBe('"a,b"');
  });
  test("newline triggers wrap (multi-line cell)", () => {
    expect(csvQuote("line1\nline2")).toBe('"line1\nline2"');
    expect(csvQuote("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
  test("quote triggers wrap and is doubled inside", () => {
    expect(csvQuote('he said "hi"')).toBe('"he said ""hi"""');
  });
  test("only-quote string", () => {
    expect(csvQuote('"')).toBe('""""');
  });
  test("unicode without specials passes through unwrapped", () => {
    // RFC 4180 specials are limited to ASCII , " CR LF — emoji and
    // non-Latin characters don't trigger quoting.
    expect(csvQuote("Über naïve")).toBe("Über naïve");
  });
});

// =============================================================================
// formatCellForExport — type-aware projection for CSV. Booleans become
// "true"/"false"; select fields project the human label not the id;
// arbitrary objects (currency, location) JSON-stringify so the column
// at least round-trips.
// =============================================================================

describe("formatCellForExport", () => {
  const text = mkField({ id: "fld-text", type: "text" });

  test("null / undefined → empty string", () => {
    expect(formatCellForExport(null, text)).toBe("");
    expect(formatCellForExport(undefined, text)).toBe("");
  });

  test("boolean field renders 'true' / 'false'", () => {
    const b = mkField({ id: "fld-b", type: "boolean" });
    expect(formatCellForExport(true, b)).toBe("true");
    expect(formatCellForExport(false, b)).toBe("false");
  });

  test("single-select projects the option label, not the id", () => {
    const sel = mkField({
      id: "fld-sel",
      type: "single-select",
      config: {
        options: [
          { id: "opt-1", label: "First" },
          { id: "opt-2", label: "Second" },
        ],
      },
    });
    expect(formatCellForExport("opt-1", sel)).toBe("First");
    expect(formatCellForExport("opt-2", sel)).toBe("Second");
  });

  test("single-select falls back to the raw id when option is unknown (deleted option)", () => {
    const sel = mkField({
      id: "fld-sel",
      type: "single-select",
      config: { options: [{ id: "opt-1", label: "First" }] },
    });
    expect(formatCellForExport("opt-removed", sel)).toBe("opt-removed");
  });

  test("multi-select joins labels with ', '", () => {
    const sel = mkField({
      id: "fld-msel",
      type: "multi-select",
      config: {
        options: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Bravo" },
          { id: "c", label: "Charlie" },
        ],
      },
    });
    expect(formatCellForExport(["a", "c"], sel)).toBe("Alpha, Charlie");
  });

  test("multi-select with unknown ids falls back per-id", () => {
    const sel = mkField({
      id: "fld-msel",
      type: "multi-select",
      config: { options: [{ id: "a", label: "Alpha" }] },
    });
    expect(formatCellForExport(["a", "missing"], sel)).toBe("Alpha, missing");
  });

  test("multi-select with non-array value still stringifies (defensive)", () => {
    const sel = mkField({
      id: "fld-msel",
      type: "multi-select",
      config: { options: [{ id: "a", label: "Alpha" }] },
    });
    // A scalar in a multi-select column is unexpected, but we shouldn't
    // throw — fall through to the generic toString path.
    expect(formatCellForExport("a", sel)).toBe("a");
  });

  test("object values JSON-stringify (currency, location, etc.)", () => {
    const cur = mkField({ id: "fld-cur", type: "currency" });
    expect(formatCellForExport({ amount: "24.50", currency: "EUR" }, cur)).toBe(
      '{"amount":"24.50","currency":"EUR"}',
    );
  });

  test("array value stringifies (relation field stores uuid arrays)", () => {
    const rel = mkField({ id: "fld-rel", type: "relation" });
    expect(formatCellForExport(["a", "b"], rel)).toBe('["a","b"]');
  });

  test("number / string / non-special types coerce via String()", () => {
    expect(formatCellForExport(42, text)).toBe("42");
    expect(formatCellForExport("hello", text)).toBe("hello");
    expect(formatCellForExport(3.14, text)).toBe("3.14");
  });
});
