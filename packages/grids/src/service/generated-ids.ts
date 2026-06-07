import { isUniqueViolation } from "@valentinkolb/cloud/services";
import { crypto, dates, type DateContext } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { fieldUniqueIndexName, nextGeneratedIdSequenceValue } from "./field-indexes";
import type { SqlClient } from "./audit";
import type { Field } from "./types";

export type IdStrategy = "sequence" | "date_sequence" | "short_code" | "random_code" | "uuid" | "uuidv7" | "ulid";

type IdConfig = {
  strategy?: IdStrategy;
  prefix?: string;
  padding?: number;
  period?: "year" | "month" | "day";
  length?: number;
  groups?: number;
  segmentLength?: number;
};

const prefixOf = (config: IdConfig): string => config.prefix ?? "";
const pad = (value: number, width = 1): string => String(value).padStart(Math.max(1, width), "0");

export const generatedIdRequiresRetry = (field: Field): boolean => {
  if (field.type !== "id") return false;
  const strategy = ((field.config as IdConfig).strategy ?? "sequence") as IdStrategy;
  return strategy === "short_code" || strategy === "random_code" || strategy === "uuid" || strategy === "uuidv7" || strategy === "ulid";
};

export const isGeneratedIdUniqueCollision = (error: unknown, fields: Field[]): boolean =>
  fields.some((field) => generatedIdRequiresRetry(field) && isUniqueViolation(error, fieldUniqueIndexName(field.id)));

const dateScope = (now: Date, config: IdConfig, dateConfig?: DateContext): string => {
  const key = dates.formatDateKey(now, dateConfig);
  switch (config.period ?? "year") {
    case "day":
      return key.replace(/-/g, "");
    case "month":
      return key.slice(0, 7).replace("-", "");
    case "year":
      return key.slice(0, 4);
  }
};

const randomCode = (config: IdConfig): string => {
  const groups = config.groups ?? 2;
  const segmentLength = config.segmentLength ?? 4;
  return crypto.common.readableId(...Array.from({ length: groups }, () => segmentLength));
};

export const generateIdValue = async (
  field: Field,
  options: {
    client?: SqlClient;
    dateConfig?: DateContext;
    now?: Date;
  } = {},
): Promise<string> => {
  const config = field.config as IdConfig;
  const strategy = config.strategy ?? "sequence";
  const prefix = prefixOf(config);
  const client = options.client ?? sql;
  const now = options.now ?? new Date();

  switch (strategy) {
    case "sequence": {
      const next = await nextGeneratedIdSequenceValue(field.id, undefined, client);
      return `${prefix}${pad(next, config.padding ?? 1)}`;
    }
    case "date_sequence": {
      const scope = dateScope(now, config, options.dateConfig);
      const next = await nextGeneratedIdSequenceValue(field.id, scope, client);
      return `${prefix}${scope}-${pad(next, config.padding ?? 4)}`;
    }
    case "short_code":
      return `${prefix}${crypto.common.readableId(config.length ?? 5)}`;
    case "random_code":
      return `${prefix}${randomCode(config)}`;
    case "uuid":
      return `${prefix}${crypto.common.uuid()}`;
    case "uuidv7":
      return `${prefix}${Bun.randomUUIDv7()}`;
    case "ulid":
      return `${prefix}${crypto.common.ulid()}`;
  }
};
