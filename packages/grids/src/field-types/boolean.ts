import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

const BoolConfigSchema = z.object({});

export const booleanHandler: FieldTypeHandler = {
  type: "boolean",
  configSchema: BoolConfigSchema,
  userInput: true,
  validate(raw, _config, required) {
    if (raw === null || raw === undefined) {
      return required ? fail("required") : ok(null);
    }
    if (typeof raw === "boolean") return ok(raw);
    // Tolerant of common API-form encodings.
    if (raw === "true" || raw === 1 || raw === "1") return ok(true);
    if (raw === "false" || raw === 0 || raw === "0") return ok(false);
    return fail("must be a boolean");
  },
};
