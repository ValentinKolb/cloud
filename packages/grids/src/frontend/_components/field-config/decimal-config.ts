import { prompts } from "@valentinkolb/cloud/ui";

/**
 * Collects decimal field config (precision + scale, optional min/max).
 * Postgres NUMERIC(p,s) caps at p ≤ 38; scale must be ≤ precision.
 */
export const collectDecimalConfig = async (
  current?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> => {
  const result = await prompts.form({
    title: "Decimal config",
    icon: "ti ti-decimal",
    fields: {
      precision: {
        type: "number",
        label: "Precision (total digits)",
        required: true,
        min: 1,
        max: 38,
        default: typeof current?.precision === "number" ? current.precision : 10,
      },
      scale: {
        type: "number",
        label: "Scale (decimal places)",
        required: true,
        min: 0,
        max: 20,
        default: typeof current?.scale === "number" ? current.scale : 2,
      },
      min: {
        type: "text",
        label: "Min (optional)",
        placeholder: "e.g. 0",
        default: typeof current?.min === "string" ? current.min : "",
      },
      max: {
        type: "text",
        label: "Max (optional)",
        placeholder: "e.g. 9999.99",
        default: typeof current?.max === "string" ? current.max : "",
      },
    },
    confirmText: "Save",
  });
  if (!result) return null;

  const precision = Number(result.precision);
  const scale = Number(result.scale);
  if (!Number.isInteger(precision) || precision < 1 || precision > 38) {
    prompts.error("Precision must be 1..38");
    return null;
  }
  if (!Number.isInteger(scale) || scale < 0 || scale > precision) {
    prompts.error("Scale must be 0..precision");
    return null;
  }
  const config: Record<string, unknown> = { precision, scale };
  if (typeof result.min === "string" && result.min.trim().length > 0) config.min = result.min.trim();
  if (typeof result.max === "string" && result.max.trim().length > 0) config.max = result.max.trim();
  return config;
};
