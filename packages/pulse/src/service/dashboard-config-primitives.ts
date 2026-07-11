import { AGGREGATIONS, PANEL_VISUALS } from "../contracts";
import type { Aggregation, DashboardRefreshInterval, PulseDashboardCondition, PulseDashboardMetricWidget } from "../contracts";

export const parseDashboardJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const normalizeTrimmedString = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

export const normalizeDurationToken = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^\d+[mhd]$/.test(value) ? value : fallback;

export const normalizeAggregation = (value: unknown, fallback: Aggregation): Aggregation =>
  AGGREGATIONS.includes(value as Aggregation) ? (value as Aggregation) : fallback;

export const normalizeVisual = (value: unknown): PulseDashboardMetricWidget["visual"] =>
  PANEL_VISUALS.includes(value as (typeof PANEL_VISUALS)[number]) ? (value as PulseDashboardMetricWidget["visual"]) : "line";

export const normalizeSpan = (value: unknown): number | undefined => {
  const span = typeof value === "number" && Number.isInteger(value) ? value : undefined;
  return span ? Math.min(12, Math.max(1, span)) : undefined;
};

export const normalizeDescription = (value: unknown, max = 500): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

export const normalizeRefreshInterval = (value: unknown): DashboardRefreshInterval | null | undefined => {
  if (value === null) return null;
  return value === 1 || value === 5 || value === 10 || value === 60 ? value : undefined;
};

const conditionLevels: PulseDashboardCondition["level"][] = ["warn", "critical"];
const conditionOperators: PulseDashboardCondition["operator"][] = [">", ">=", "<", "<=", "=", "!="];

const normalizeConditionLevel = (value: unknown): PulseDashboardCondition["level"] | null =>
  conditionLevels.includes(value as PulseDashboardCondition["level"]) ? (value as PulseDashboardCondition["level"]) : null;

const normalizeConditionOperator = (value: unknown): PulseDashboardCondition["operator"] | null =>
  conditionOperators.includes(value as PulseDashboardCondition["operator"]) ? (value as PulseDashboardCondition["operator"]) : null;

const normalizeConditionValue = (value: unknown): PulseDashboardCondition["value"] | null =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;

const normalizeConditionMessage = (value: unknown): string | null => (typeof value === "string" ? value.trim().slice(0, 240) : null);

const normalizeCondition = (condition: unknown): PulseDashboardCondition | null => {
  if (!isRecord(condition)) return null;
  const level = normalizeConditionLevel(condition.level);
  const operator = normalizeConditionOperator(condition.operator);
  const conditionValue = normalizeConditionValue(condition.value);
  if (!level || !operator || conditionValue === null) return null;
  return {
    level,
    operator,
    value: conditionValue,
    message: normalizeConditionMessage(condition.message),
  };
};

export const normalizeConditions = (conditions: unknown): PulseDashboardCondition[] | undefined => {
  if (!Array.isArray(conditions)) return undefined;
  const normalized = conditions.map(normalizeCondition).filter((item): item is PulseDashboardCondition => item !== null).slice(0, 8);
  return normalized.length ? normalized : undefined;
};
