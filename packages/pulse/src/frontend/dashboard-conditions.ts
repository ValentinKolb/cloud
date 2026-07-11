import type { PulseDashboardCondition } from "../contracts";

const CONDITION_MATCHERS: Record<PulseDashboardCondition["operator"], (value: number, target: number) => boolean> = {
  ">": (value, target) => value > target,
  ">=": (value, target) => value >= target,
  "<": (value, target) => value < target,
  "<=": (value, target) => value <= target,
  "=": (value, target) => value === target,
  "!=": (value, target) => value !== target,
};

const conditionMatchesValue = (condition: PulseDashboardCondition, value: number): boolean => {
  const target = typeof condition.value === "number" ? condition.value : Number(condition.value);
  if (!Number.isFinite(target)) return false;
  return CONDITION_MATCHERS[condition.operator](value, target);
};

export const matchDashboardCondition = (
  conditions: readonly PulseDashboardCondition[] | undefined,
  value: number | null,
): PulseDashboardCondition | null => {
  if (value === null || !conditions?.length) return null;
  let match: PulseDashboardCondition | null = null;
  for (const condition of conditions) {
    if (!conditionMatchesValue(condition, value)) continue;
    match = condition;
    if (condition.level === "critical") break;
  }
  return match;
};

export const formatDashboardConditionText = (condition: PulseDashboardCondition): string =>
  condition.message?.trim() || `${condition.level === "critical" ? "Critical" : "Warning"} when value ${condition.operator} ${String(condition.value)}`;
