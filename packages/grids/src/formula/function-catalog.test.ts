import { expect, test } from "bun:test";
import { formulaFunctionArity, GRID_FORMULA_FUNCTIONS } from "./function-catalog";
import { FN_LIBRARY } from "./functions";

test("formula catalog matches the evaluator and owns function arity", () => {
  expect(GRID_FORMULA_FUNCTIONS.map((fn) => fn.name).sort()).toEqual(Object.keys(FN_LIBRARY).sort());

  const arity = Object.fromEntries(GRID_FORMULA_FUNCTIONS.map((fn) => [fn.name, formulaFunctionArity(fn)]));
  expect(arity.ROUND).toEqual({ min: 1, max: 2 });
  expect(arity.SUM).toEqual({ min: 1, max: Number.POSITIVE_INFINITY });
  expect(arity.TODAY).toEqual({ min: 0, max: 0 });
  expect(arity.DATEADD).toEqual({ min: 2, max: 3 });
});
