import { describe, expect, test } from "bun:test";
import { rewriteFormulaIdentifierRefs, rewriteIdentifierRefs } from "./ref-rewrite";

describe("rewriteIdentifierRefs", () => {
  test("rewrites bare field names and quotes replacements when needed", () => {
    expect(rewriteIdentifierRefs("Price + Tax", { oldName: "Price", newName: "Unit price" })).toEqual({
      text: '"Unit price" + Tax',
      changed: true,
    });
  });

  test("rewrites double-quoted identifiers", () => {
    expect(rewriteIdentifierRefs('"Unit price" * Quantity', { oldName: "Unit price", newName: "Net price" })).toEqual({
      text: '"Net price" * Quantity',
      changed: true,
    });
  });

  test("does not rewrite string literals", () => {
    expect(rewriteIdentifierRefs("CONCAT('Price', Price)", { oldName: "Price", newName: "Amount" })).toEqual({
      text: "CONCAT('Price', Amount)",
      changed: true,
    });
  });

  test("does not rewrite function names", () => {
    expect(rewriteIdentifierRefs("SUM(Price)", { oldName: "SUM", newName: "Total" })).toEqual({
      text: "SUM(Price)",
      changed: false,
    });
  });

  test("matches names case-insensitively", () => {
    expect(rewriteIdentifierRefs("price + PRICE", { oldName: "Price", newName: "Total" })).toEqual({
      text: "Total + Total",
      changed: true,
    });
  });

  test("escapes quoted replacement names", () => {
    expect(rewriteIdentifierRefs("Price", { oldName: "Price", newName: 'Net "retail"' })).toEqual({
      text: '"Net ""retail"""',
      changed: true,
    });
  });
});

describe("rewriteFormulaIdentifierRefs", () => {
  test("rewrites field refs from parser spans", () => {
    expect(rewriteFormulaIdentifierRefs("Price + Tax", { oldName: "Price", newName: "Unit price" })).toEqual({
      text: '"Unit price" + Tax',
      changed: true,
    });
  });

  test("keeps string literals and function names untouched", () => {
    expect(rewriteFormulaIdentifierRefs("IFEMPTY(Notes, 'Price')", { oldName: "Price", newName: "Amount" })).toEqual({
      text: "IFEMPTY(Notes, 'Price')",
      changed: false,
    });
    expect(rewriteFormulaIdentifierRefs("SUM(Price)", { oldName: "SUM", newName: "Total" })).toEqual({
      text: "SUM(Price)",
      changed: false,
    });
  });

  test("rewrites nested formula refs and leading equals formulas", () => {
    expect(rewriteFormulaIdentifierRefs("=ROUND(Price * Quantity, 2)", { oldName: "Price", newName: "Net price" })).toEqual({
      text: '=ROUND("Net price" * Quantity, 2)',
      changed: true,
    });
  });
});
