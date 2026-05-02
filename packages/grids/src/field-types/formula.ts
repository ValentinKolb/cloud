import { z } from "zod";
import { fail, type FieldTypeHandler } from "./types";
import { parseFormula } from "../formula/parser";

// Refine the expression at schema-level so the field-service config
// validator catches malformed formulas at save-time. Without the refine,
// only userInput's `validate()` (skipped for read-only fields) would
// parse-check; a typo like `1 +` would be silently accepted and then
// disappear at record-enrichment time.
const FormulaConfigSchema = z
  .object({ expression: z.string().min(1) })
  .superRefine((cfg, ctx) => {
    const result = parseFormula(cfg.expression);
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
