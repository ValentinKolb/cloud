import Decimal from "decimal.js";
import { z } from "zod";
import { fail, ok, type ValueFieldType } from "./types";

type NumberConfigInput = {
  min?: string | number;
  max?: string | number;
  precision?: number;
  decimalPlaces?: number;
  scale?: number;
  integerOnly?: boolean;
};

type ConfigIssue = {
  message: string;
  path: string[];
};

const NumberConfigSchema = z
  .object({
    min: z.union([z.string(), z.number()]).optional(),
    max: z.union([z.string(), z.number()]).optional(),
    precision: z.number().int().min(1).max(38).optional(),
    decimalPlaces: z.number().int().min(0).max(20).optional(),
    /** Legacy input accepted while alpha DBs still contain old decimal configs. */
    scale: z.number().int().min(0).max(20).optional(),
    integerOnly: z.boolean().optional(),
    unit: z.string().min(1).max(20).optional(),
    unitPosition: z.enum(["prefix", "suffix"]).optional(),
  })
  .superRefine((data, ctx) => {
    for (const issue of numberConfigIssues(data)) ctx.addIssue({ code: z.ZodIssueCode.custom, ...issue });
  });

const parseFiniteDecimal = (raw: string): Decimal | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const d = new Decimal(trimmed);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
};

const parseConfigDecimal = (value: unknown): Decimal | null => parseDecimal(value);

const configuredPlacesInput = (config: NumberConfigInput): number | undefined =>
  config.integerOnly ? 0 : (config.decimalPlaces ?? config.scale);

const decimalPlacesConfigIssue = (config: NumberConfigInput): ConfigIssue | null => {
  const places = configuredPlacesInput(config);
  return config.precision !== undefined && places !== undefined && places > config.precision
    ? { message: "decimal places cannot exceed precision", path: ["decimalPlaces"] }
    : null;
};

const configDecimalIssue = (key: "min" | "max", value: string | number | undefined): ConfigIssue | null =>
  value !== undefined && parseConfigDecimal(value) === null ? { message: `${key} must be a number`, path: [key] } : null;

const minMaxConfigIssue = (config: NumberConfigInput): ConfigIssue | null => {
  const min = parseConfigDecimal(config.min);
  const max = parseConfigDecimal(config.max);
  return min !== null && max !== null && min.gt(max) ? { message: "min cannot exceed max", path: ["min"] } : null;
};

const numberConfigIssues = (config: NumberConfigInput): ConfigIssue[] =>
  [
    decimalPlacesConfigIssue(config),
    configDecimalIssue("min", config.min),
    configDecimalIssue("max", config.max),
    minMaxConfigIssue(config),
  ].filter((issue): issue is ConfigIssue => issue !== null);

const decimalText = (raw: unknown): string | null => (typeof raw === "number" || typeof raw === "string" ? String(raw) : null);

const amountValue = (raw: unknown): unknown =>
  typeof raw === "object" && raw !== null && "amount" in raw ? (raw as { amount?: unknown }).amount : raw;

const parseDecimal = (raw: unknown): Decimal | null => {
  const text = decimalText(amountValue(raw));
  return text === null ? null : parseFiniteDecimal(text);
};

type NumberConfig = z.infer<typeof NumberConfigSchema>;

const isEmptyInput = (raw: unknown): boolean => raw === null || raw === undefined || raw === "";

const configuredDecimalPlaces = (config: NumberConfig): number | undefined =>
  config.integerOnly ? 0 : (config.decimalPlaces ?? config.scale);

const decimalPlacesError = (dec: Decimal, places: number | undefined): string | null => {
  if (places === undefined || dec.decimalPlaces() <= places) return null;
  return places === 0 ? "must be an integer" : `max ${places} decimal places`;
};

const integerOnlyError = (dec: Decimal, config: NumberConfig): string | null =>
  config.integerOnly && !dec.isInteger() ? "must be an integer" : null;

const integerDigitCount = (dec: Decimal): number => (dec.isZero() ? 0 : Math.max(0, dec.precision(true) - dec.decimalPlaces()));

const precisionError = (dec: Decimal, config: NumberConfig, places: number | undefined): string | null => {
  if (config.precision === undefined) return null;
  const maxPlaces = places ?? dec.decimalPlaces();
  const maxIntegerDigits = config.precision - maxPlaces;
  return integerDigitCount(dec) > maxIntegerDigits
    ? `exceeds precision ${config.precision} (max ${maxIntegerDigits} integer digits)`
    : null;
};

const rangeError = (dec: Decimal, config: NumberConfig): string | null => {
  const min = parseConfigDecimal(config.min);
  if (min !== null && dec.lt(min)) return `min ${config.min}`;
  const max = parseConfigDecimal(config.max);
  if (max !== null && dec.gt(max)) return `max ${config.max}`;
  return null;
};

const firstNumberError = (dec: Decimal, config: NumberConfig, places: number | undefined): string | null =>
  decimalPlacesError(dec, places) ?? integerOnlyError(dec, config) ?? precisionError(dec, config, places) ?? rangeError(dec, config);

export const numberHandler: ValueFieldType = {
  type: "number",
  kind: "value",
  configSchema: NumberConfigSchema,
  validate(raw, configRaw, required) {
    const parsed = NumberConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid field config");
    const config = parsed.data;

    if (isEmptyInput(raw)) return required ? fail("required") : ok(null);

    const dec = parseDecimal(raw);
    if (dec === null) return fail("must be a finite number");

    const places = configuredDecimalPlaces(config);
    const error = firstNumberError(dec, config, places);
    if (error) return fail(error);

    return ok(places !== undefined ? dec.toFixed(places) : dec.toFixed());
  },
};
