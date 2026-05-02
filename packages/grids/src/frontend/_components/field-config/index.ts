import { collectDecimalConfig } from "./decimal-config";
import { collectSelectConfig } from "./select-config";

/**
 * Opens a type-specific config dialog and returns the config blob (or
 * null if cancelled). Returns `{}` for types that don't need extra
 * config so callers can always submit `config: result ?? undefined`.
 *
 * The collected blob matches what the field-types validators expect
 * (decimal: precision/scale; selects: options[]). Field types not
 * listed here have safe empty defaults and skip the modal entirely.
 */
export const collectConfigForType = async (
  type: string,
  current?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> => {
  switch (type) {
    case "decimal":
      return collectDecimalConfig(current);
    case "single-select":
    case "multi-select":
      return collectSelectConfig(type, current);
    default:
      return {};
  }
};

export const typeNeedsConfig = (type: string): boolean => {
  return type === "decimal" || type === "single-select" || type === "multi-select";
};
