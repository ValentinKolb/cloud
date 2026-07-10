import type { FormulaFunction } from "./function-runtime";
import { DATE_FORMULA_FUNCTIONS } from "./functions-date";
import { MATH_FORMULA_FUNCTIONS } from "./functions-math";
import { TEXT_LOGIC_FORMULA_FUNCTIONS } from "./functions-text-logic";

export type { FormulaRuntimeContext } from "./function-runtime";
export { isFormulaError } from "./types";

export const FN_LIBRARY: Record<string, FormulaFunction> = {
  ...MATH_FORMULA_FUNCTIONS,
  ...TEXT_LOGIC_FORMULA_FUNCTIONS,
  ...DATE_FORMULA_FUNCTIONS,
};
