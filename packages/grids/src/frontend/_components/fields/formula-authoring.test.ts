import { describe, expect, test } from "bun:test";
import type { Field } from "../../service";
import {
  buildFormulaCompletions,
  expectedFormulaValueType,
  formulaFieldRefs,
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
  field({ id: "price", shortId: "Pr1cE", name: "Unit price", type: "decimal" }),
  field({ id: "qty", shortId: "Qty01", name: "Quantity", type: "number" }),
  field({ id: "name", shortId: "Nm001", name: "Product name", type: "text" }),
  field({ id: "date", shortId: "Date1", name: "Invoice date", type: "date" }),
  field({ id: "files", shortId: "File1", name: "Files", type: "file" }),
]);

describe("formula authoring helpers", () => {
  test("field reference list excludes unsuitable fields", () => {
    expect(fields.map((f) => f.name)).toEqual(["Unit price", "Quantity", "Product name", "Invoice date"]);
  });

  test("expected type follows nested function argument context despite whitespace", () => {
    expect(expectedFormulaValueType("IF(CONTAINS( Product", "IF(CONTAINS( Product".length - "Product".length)).toBe("text");
    expect(expectedFormulaValueType("SUM( IF(TRUE, ", "SUM( IF(TRUE, ".length)).toBe("any");
    expect(expectedFormulaValueType("#Qty01 * ", "#Qty01 * ".length)).toBe("number");
    expect(expectedFormulaValueType("DATEDIFF( TODAY(), ", "DATEDIFF( TODAY(), ".length)).toBe("date");
  });

  test("value suggestions insert #shortId while showing field names", () => {
    const suggestions = formulaValueSuggestions(fields, "unit", {
      fullText: "SUM(unit",
      tokenStart: "SUM(".length,
    });
    expect(suggestions[0]).toMatchObject({
      text: "Unit price",
      expansion: "#Pr1cE",
      label: "Unit price",
      hint: "decimal · #Pr1cE",
    });
  });

  test("numeric contexts filter out text fields and still offer numeric functions", () => {
    const suggestions = formulaValueSuggestions(fields, "", {
      fullText: "#Qty01 * ",
      tokenStart: "#Qty01 * ".length,
    });
    const labels = suggestions.map((s) => s.label ?? s.text);
    expect(labels).toContain("Unit price");
    expect(labels).toContain("Quantity");
    expect(labels).toContain("SUM");
    expect(labels).not.toContain("Product name");
  });

  test("completions support # trigger by field name", () => {
    const hashCompletion = buildFormulaCompletions(fields).find((c) => c.trigger === "#")!;
    const suggestions = hashCompletion.suggest("prod", { fullText: "#prod", caret: 5, tokenStart: 0 }, new AbortController().signal);
    expect(Array.isArray(suggestions)).toBe(true);
    if (Array.isArray(suggestions)) {
      expect(suggestions[0]).toMatchObject({ label: "Product name", expansion: "#Nm001" });
    }
  });

  test("equals completion only fires at the start of an expression", () => {
    const equalsCompletion = buildFormulaCompletions(fields).find((c) => c.trigger === "=")!;
    const startSuggestions = equalsCompletion.suggest("su", { fullText: "=su", caret: 3, tokenStart: 0 }, new AbortController().signal);
    expect(Array.isArray(startSuggestions) && startSuggestions.some((s) => s.label === "SUM")).toBe(true);

    const comparisonSuggestions = equalsCompletion.suggest(
      "su",
      { fullText: "#Qty01 = su", caret: 11, tokenStart: 8 },
      new AbortController().signal,
    );
    expect(comparisonSuggestions).toEqual([]);
  });

  test("highlight escapes html and marks formula tokens", () => {
    expect(formulaHighlight('SUM(#Pr1cE, 2) < "x"')).toContain('<span class="fn">SUM</span>');
    expect(formulaHighlight('SUM(#Pr1cE, 2) < "x"')).toContain('<span class="field">#Pr1cE</span>');
    expect(formulaHighlight('SUM(#Pr1cE, 2) < "x"')).toContain('<span class="num">2</span>');
    expect(formulaHighlight('SUM(#Pr1cE, 2) < "x"')).toContain("&lt;");
  });
});
