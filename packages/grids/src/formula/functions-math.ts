import Decimal from "decimal.js";
import { type FormulaFunction, type FormulaFunctionReturn, formulaNumber } from "./function-runtime";
import { decimalResult, isNullish, toDecimalValue } from "./numeric";
import { formulaError } from "./types";

const decimalArgs = (args: unknown[]) => {
  const values = args.map(toDecimalValue).filter((value): value is NonNullable<ReturnType<typeof toDecimalValue>> => value !== null);
  return { values, exact: values.some((value) => value.exact) };
};

const oneDecimal = (value: unknown): NonNullable<ReturnType<typeof toDecimalValue>> | null => toDecimalValue(value);
const numericResult = (value: Decimal, exact: boolean): FormulaFunctionReturn => decimalResult(value, exact);

const average: FormulaFunction = (args) => {
  const { values, exact } = decimalArgs(args);
  if (values.length === 0) return null;
  const sum = values.reduce((acc, value) => acc.plus(value.decimal), new Decimal(0));
  return numericResult(sum.div(values.length), exact);
};

export const MATH_FORMULA_FUNCTIONS: Record<string, FormulaFunction> = {
  ABS: ([value]) => {
    const decimal = oneDecimal(value);
    return decimal === null ? null : numericResult(decimal.decimal.abs(), decimal.exact);
  },
  ROUND: ([value, places]) => {
    const decimal = oneDecimal(value);
    if (decimal === null) return null;
    const placesInt = Math.trunc(formulaNumber(places) ?? 0);
    if (placesInt < 0) {
      const factor = new Decimal(10).pow(Math.abs(placesInt));
      return numericResult(decimal.decimal.div(factor).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(factor), decimal.exact);
    }
    return numericResult(decimal.decimal.toDecimalPlaces(placesInt, Decimal.ROUND_HALF_UP), decimal.exact);
  },
  FLOOR: ([value]) => {
    const decimal = oneDecimal(value);
    return decimal === null ? null : numericResult(decimal.decimal.floor(), decimal.exact);
  },
  CEIL: ([value]) => {
    const decimal = oneDecimal(value);
    return decimal === null ? null : numericResult(decimal.decimal.ceil(), decimal.exact);
  },
  SQRT: ([value]) => {
    const decimal = oneDecimal(value);
    if (decimal === null) return null;
    if (decimal.decimal.isNegative()) return formulaError("NON_NUMERIC");
    return numericResult(decimal.decimal.sqrt(), decimal.exact);
  },
  POW: ([base, exponent]) => {
    const left = oneDecimal(base);
    const right = oneDecimal(exponent);
    if (left === null || right === null) return null;
    return numericResult(left.decimal.pow(right.decimal), left.exact || right.exact);
  },
  MOD: ([dividend, divisor]) => {
    const left = oneDecimal(dividend);
    const right = oneDecimal(divisor);
    if (left === null || right === null) return null;
    if (right.decimal.isZero()) return formulaError("DIV_ZERO");
    return numericResult(left.decimal.mod(right.decimal), left.exact || right.exact);
  },
  SUM: (args) => {
    const { values, exact } = decimalArgs(args);
    if (values.length === 0) return null;
    return numericResult(
      values.reduce((sum, value) => sum.plus(value.decimal), new Decimal(0)),
      exact,
    );
  },
  AVG: average,
  MEAN: average,
  COUNT: (args) => args.filter((value) => !isNullish(value) && value !== "").length,
  MEDIAN: (args) => {
    const { values, exact } = decimalArgs(args);
    if (values.length === 0) return null;
    const sorted = values.map((value) => value.decimal).sort((left, right) => left.comparedTo(right));
    const middle = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 0 ? sorted[middle - 1]!.plus(sorted[middle]!).div(2) : sorted[middle]!;
    return numericResult(value, exact);
  },
  MIN: (args) => {
    const { values, exact } = decimalArgs(args);
    return values.length === 0 ? null : numericResult(Decimal.min(...values.map((value) => value.decimal)), exact);
  },
  MAX: (args) => {
    const { values, exact } = decimalArgs(args);
    return values.length === 0 ? null : numericResult(Decimal.max(...values.map((value) => value.decimal)), exact);
  },
  PERCENT: ([part, total]) => {
    const numerator = oneDecimal(part);
    const denominator = oneDecimal(total);
    if (numerator === null || denominator === null) return null;
    if (denominator.decimal.isZero()) return formulaError("DIV_ZERO");
    return numericResult(numerator.decimal.div(denominator.decimal).times(100), numerator.exact || denominator.exact);
  },
};
