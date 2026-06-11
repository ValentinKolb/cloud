import { describe, expect, test } from "bun:test";
import { parseFormula } from "../../../formula/parser";
import type { Field } from "../../../service";
import {
  buildFormulaCompletions,
  expectedFormulaValueType,
  formulaFieldRefs,
  formulaFieldToken,
  formulaHighlight,
  formulaValueSuggestions,
} from "./formula-authoring";

const field = (overrides: Partial<Field> & Pick<Field, "id" | "shortId" | "name" | "type">): Field => ({
  tableId: "table",
  description: null,
  icon: null,
  config: {},
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const fields = formulaFieldRefs([
  field({ id: "price", shortId: "Pr1cE", name: "Unit price", type: "number" }),
  field({ id: "qty", shortId: "Qty01", name: "Quantity", type: "number" }),
  field({ id: "name", shortId: "Nm001", name: "Product name", type: "text" }),
  field({ id: "date", shortId: "Date1", name: "Invoice date", type: "date" }),
  field({ id: "discount", shortId: "Dc99X", name: "Discount % / special", type: "percent" }),
  field({ id: "files", shortId: "File1", name: "Files", type: "file" }),
]);

describe("formula authoring helpers", () => {
  test("field reference list excludes unsuitable fields", () => {
    expect(fields.map((f) => f.name)).toEqual(["Unit price", "Quantity", "Product name", "Invoice date", "Discount % / special"]);
  });

  test("field reference list excludes the formula field being edited", () => {
    const refs = formulaFieldRefs(
      [
        field({ id: "price", shortId: "Pr1cE", name: "Unit price", type: "number" }),
        field({ id: "total", shortId: "Tot01", name: "Total", type: "formula" }),
      ],
      "total",
    );
    expect(refs.map((f) => f.id)).toEqual(["price"]);
  });

  test("expected type follows nested function argument context despite whitespace", () => {
    expect(expectedFormulaValueType("IF(CONTAINS( Product", "IF(CONTAINS( Product".length - "Product".length)).toBe("text");
    expect(expectedFormulaValueType("SUM( IF(TRUE, ", "SUM( IF(TRUE, ".length)).toBe("any");
    expect(expectedFormulaValueType("Quantity * ", "Quantity * ".length)).toBe("number");
    expect(expectedFormulaValueType("DATEDIFF( TODAY(), ", "DATEDIFF( TODAY(), ".length)).toBe("date");
  });

  test("value suggestions insert field names while showing field metadata", () => {
    const suggestions = formulaValueSuggestions(fields, "unit", {
      fullText: "SUM(unit",
      tokenStart: "SUM(".length,
    });
    expect(suggestions[0]).toMatchObject({
      text: "Unit price",
      expansion: '"Unit price"',
      label: "Unit price",
      hint: 'number · "Unit price"',
    });
    expect(parseFormula(suggestions[0]!.expansion ?? "")).toMatchObject({ ok: true });
  });

  test("numeric contexts filter out text fields and still offer numeric functions", () => {
    const suggestions = formulaValueSuggestions(fields, "", {
      fullText: "Quantity * ",
      tokenStart: "Quantity * ".length,
    });
    const labels = suggestions.map((s) => s.label ?? s.text);
    expect(labels).toContain("Unit price");
    expect(labels).toContain("Quantity");
    expect(labels).toContain("SUM");
    expect(labels.indexOf("Unit price")).toBeLessThan(labels.indexOf("Product name"));
  });

  test("numeric operator contexts still show matching non-numeric fields", () => {
    const suggestions = formulaValueSuggestions(fields, "prod", {
      fullText: "Quantity * prod",
      tokenStart: "Quantity * ".length,
    });
    expect(suggestions[0]).toMatchObject({ label: "Product name", expansion: '"Product name"' });
  });

  test("completions support # trigger by field name", () => {
    const hashCompletion = buildFormulaCompletions(fields).find((c) => c.trigger === "#")!;
    const suggestions = hashCompletion.suggest("prod", { fullText: "#prod", caret: 5, tokenStart: 0 }, new AbortController().signal);
    expect(Array.isArray(suggestions)).toBe(true);
    if (Array.isArray(suggestions)) {
      expect(suggestions[0]).toMatchObject({ label: "Product name", expansion: '"Product name"' });
      expect(parseFormula(suggestions[0]!.expansion ?? "")).toMatchObject({ ok: true });
    }
  });

  test("space completion ignores whitespace after value-position operators", () => {
    const spaceCompletion = buildFormulaCompletions(fields).find((c) => c.trigger === " ")!;
    const suggestions = spaceCompletion.suggest(
      "prod",
      { fullText: "Quantity +    prod", caret: "Quantity +    prod".length, tokenStart: "Quantity +   ".length },
      new AbortController().signal,
    );
    expect(Array.isArray(suggestions)).toBe(true);
    if (Array.isArray(suggestions)) {
      expect(suggestions[0]).toMatchObject({ label: "Product name", expansion: '"Product name"' });
    }
  });

  test("space completion does not fire after a completed value", () => {
    const spaceCompletion = buildFormulaCompletions(fields).find((c) => c.trigger === " ")!;
    const suggestions = spaceCompletion.suggest(
      "prod",
      { fullText: "Quantity prod", caret: "Quantity prod".length, tokenStart: "Quantity".length },
      new AbortController().signal,
    );
    expect(suggestions).toEqual([]);
  });

  test("field names with spaces or symbols insert quoted identifiers", () => {
    const suggestions = formulaValueSuggestions(fields, "special", {
      fullText: "ROUND(special",
      tokenStart: "ROUND(".length,
    });
    expect(suggestions[0]).toMatchObject({
      text: "Discount % / special",
      expansion: '"Discount % / special"',
      label: "Discount % / special",
      hint: 'percent · "Discount % / special"',
    });
    expect(parseFormula(`ROUND(${suggestions[0]!.expansion}, 2)`)).toMatchObject({ ok: true });
  });

  test("formulaFieldToken keeps field references readable and parseable", () => {
    expect(formulaFieldToken({ name: "Unit price" })).toBe('"Unit price"');
    expect(formulaFieldToken({ name: "Price" })).toBe("Price");
  });

  test("equals completion only fires at the start of an expression", () => {
    const equalsCompletion = buildFormulaCompletions(fields).find((c) => c.trigger === "=")!;
    const startSuggestions = equalsCompletion.suggest("su", { fullText: "=su", caret: 3, tokenStart: 0 }, new AbortController().signal);
    expect(Array.isArray(startSuggestions) && startSuggestions.some((s) => s.label === "SUM")).toBe(true);

    const comparisonSuggestions = equalsCompletion.suggest(
      "su",
      { fullText: "Quantity = su", caret: "Quantity = su".length, tokenStart: "Quantity = ".length },
      new AbortController().signal,
    );
    expect(comparisonSuggestions).toEqual([]);
  });

  test("highlight escapes html and marks formula tokens", () => {
    expect(formulaHighlight("SUM(Price, 2) < 'x'")).toContain('<span class="fn">SUM</span>');
    expect(formulaHighlight("SUM(Price, 2) < 'x'")).toContain('<span class="field">Price</span>');
    expect(formulaHighlight("SUM(Price, 2) < 'x'")).toContain('<span class="num">2</span>');
    expect(formulaHighlight("SUM(Price, 2) < 'x'")).toContain("<span class=\"str\">'x'</span>");
    expect(formulaHighlight("SUM(Price, 2) < 'x'")).toContain("&lt;");
  });
});
