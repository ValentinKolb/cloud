import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";
import { parseFormula } from "../formula/parser";

const FormulaConfigSchema = z.object({
  expression: z.string().min(1),
});

/**
 * Formula field — read-only, computed at records.list time. Validation
 * here only checks the expression PARSES; type inference and evaluation
 * happen in the formula engine. Cycles are caught in the service layer
 * because they need access to other fields' configs.
 */
export const formulaHandler: FieldTypeHandler = {
  type: "formula",
  configSchema: FormulaConfigSchema,
  userInput: false,
  validate(_raw, configRaw, _required) {
    const parsed = FormulaConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("formula needs an `expression` config");
    const result = parseFormula(parsed.data.expression);
    if (!result.ok) return fail(`formula parse error: ${result.error}`);
    // userInput=false — caller never gets here for record submissions.
    // Defensive: a payload that targets a formula field is rejected.
    return fail("formula is read-only — set value via the relation/expression");
  },
};

export { parseFormula };
