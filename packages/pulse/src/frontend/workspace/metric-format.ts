import { text } from "@valentinkolb/stdlib";

const trimFixed = (value: number, fractionDigits: number): string => {
  const fixed = value.toFixed(fractionDigits);
  return fractionDigits === 0 ? fixed : fixed.replace(/\.?0+$/, "");
};

const isFiniteMetricNumber = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

const valueFormatThresholds: Array<{ min: number; format: (value: number) => string }> = [
  { min: 1_000_000, format: (value) => value.toExponential(2) },
  { min: 100, format: (value) => trimFixed(value, 0) },
  { min: 10, format: (value) => trimFixed(value, 1) },
  { min: 1, format: (value) => trimFixed(value, 2) },
  { min: 0.01, format: (value) => trimFixed(value, 3) },
];

export const formatValue = (value: number | null | undefined): string => {
  if (!isFiniteMetricNumber(value)) return "n/a";
  if (value === 0) return "0";
  const absolute = Math.abs(value);
  const threshold = valueFormatThresholds.find(({ min }) => absolute >= min);
  return threshold ? threshold.format(value) : trimFixed(value, 4);
};

type MetricUnitKind = "bytes" | "count" | "milliseconds" | "percent" | "seconds" | "unknown";

const metricUnitAliases: Record<string, Exclude<MetricUnitKind, "unknown">> = {
  "%": "percent",
  b: "bytes",
  byte: "bytes",
  bytes: "bytes",
  count: "count",
  counts: "count",
  millisecond: "milliseconds",
  milliseconds: "milliseconds",
  ms: "milliseconds",
  percent: "percent",
  percentage: "percent",
  s: "seconds",
  sec: "seconds",
  secs: "seconds",
  second: "seconds",
  seconds: "seconds",
};

const compactMetricUnits: Record<Exclude<MetricUnitKind, "unknown">, string | undefined> = {
  bytes: "B",
  count: undefined,
  milliseconds: "ms",
  percent: "%",
  seconds: "s",
};

const metricUnitKind = (unit: string | null | undefined): MetricUnitKind => {
  const normalized = unit?.trim().toLowerCase();
  if (!normalized) return "unknown";
  return metricUnitAliases[normalized] ?? "unknown";
};

export const compactMetricUnit = (unit: string | null | undefined): string | undefined => {
  const value = unit?.trim();
  if (!value) return undefined;
  const kind = metricUnitKind(value);
  return kind === "unknown" ? value : compactMetricUnits[kind];
};

const formatSeconds = (seconds: number): string => {
  const sign = seconds < 0 ? "-" : "";
  const absolute = Math.abs(seconds);
  if (absolute < 1) return `${sign}${formatValue(absolute * 1000)}ms`;
  if (absolute < 60) return `${sign}${formatValue(absolute)}s`;
  return `${sign}${formatRoundedSeconds(absolute)}`;
};

const formatRoundedSeconds = (seconds: number): string => {
  const totalSeconds = Math.round(seconds);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  return `${minutes}m${remainingSeconds > 0 ? ` ${remainingSeconds}s` : ""}`;
};

const metricValueFormatters: Partial<Record<MetricUnitKind, (value: number) => string>> = {
  bytes: (value) => `${value < 0 ? "-" : ""}${text.pprintBytes(Math.abs(value))}`,
  count: formatValue,
  milliseconds: (value) => formatSeconds(value / 1000),
  percent: (value) => `${trimFixed(value, Math.abs(value) >= 100 ? 0 : 2)}%`,
  seconds: formatSeconds,
};

export const formatMetricValue = (value: number | null | undefined, unit?: string | null): string => {
  if (!isFiniteMetricNumber(value)) return "n/a";
  const kind = metricUnitKind(unit);
  const formatter = metricValueFormatters[kind];
  if (formatter) return formatter(value);
  const compactUnit = compactMetricUnit(unit);
  return compactUnit ? `${formatValue(value)} ${compactUnit}` : formatValue(value);
};

const signalValueFormatters: Partial<Record<string, (value: unknown) => string>> = {
  boolean: (value) => ((value as boolean) ? "true" : "false"),
  number: (value) => formatValue(value as number),
  string: (value) => value as string,
};

export const formatSignalValue = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  const formatter = signalValueFormatters[typeof value];
  if (formatter) return formatter(value);
  return JSON.stringify(value);
};

export const gaugeMax = (unit: string | null, value: number): number => {
  if (metricUnitKind(unit) === "percent") return 100;
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)));
  return Math.ceil(value / magnitude) * magnitude;
};
