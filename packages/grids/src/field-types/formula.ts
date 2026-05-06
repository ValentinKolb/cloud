import { z } from "zod";
import { fail, type FieldTypeHandler } from "./types";
import { parseFormula } from "../formula/parser";

// Expression is optional at create-time so a brand-new formula field
// can be added before the user has typed the formula in. Once an
// expression is present, the superRefine parse-checks it so typos like
// `1 +` get rejected at save-time rather than disappearing at record-
// enrichment time.
const FormulaConfigSchema = z
  .object({ expression: z.string().optional() })
  .superRefine((cfg, ctx) => {
    const expr = cfg.expression?.trim();
    if (!expr) return;
    const result = parseFormula(expr);
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `formula parse error: ${result.error}`,
        path: ["expression"],
      });
    }
  });

/**
 * Formula field — read-only, computed at records.list time. Save-time
 * validation parses the expression via the config schema's superRefine
 * above. The handler's `validate()` is unreachable in normal flow
 * (userInput=false) but stays as a defensive belt-and-suspenders check.
 */
export const formulaHandler: FieldTypeHandler = {
  type: "formula",
  configSchema: FormulaConfigSchema,
  userInput: false,
  validate: () => fail("formula is read-only — derived from the expression"),
};

export { parseFormula };
