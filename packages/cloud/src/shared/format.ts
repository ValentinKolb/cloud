/**
 * Presentation formatting shared across Cloud surfaces.
 *
 * These existed as ~30 local copies that disagreed with each other: the same
 * count rendered as `1.234.567`, `1,234,567` and `1234.6k` on adjacent pages,
 * the same duration as `90.00s` and `2m`, and seven hand-written date
 * formatters hardcoded `de-DE` and so ignored the viewer's configured locale
 * and timezone entirely.
 *
 * Anything `@valentinkolb/stdlib` already owns is delegated to, not
 * reimplemented — bytes via `text.pprintBytes`, dates via `dates.*`. Only the
 * pieces stdlib has no equivalent for live here, and a feature request is out
 * to move number/percent/duration formatting there too; when it lands these
 * become thin re-exports.
 */
import { type DateContext, dates, text } from "@valentinkolb/stdlib";

/** Shown where a value is genuinely absent, as opposed to zero. */
export const EMPTY_VALUE = "—";

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export type FormatOptions = {
  /** Rendered when the value is null, undefined or not finite. */
  fallback?: string;
  locale?: string;
};

/**
 * Grouped count. `compact` switches to `1.2k` / `3.4M` for dense surfaces
 * where the exact figure is not the point.
 */
export const formatNumber = (value: number | null | undefined, options: FormatOptions & { compact?: boolean } = {}): string => {
  if (!isNumber(value)) return options.fallback ?? EMPTY_VALUE;
  return new Intl.NumberFormat(options.locale, {
    notation: options.compact ? "compact" : "standard",
    maximumFractionDigits: options.compact ? 1 : 0,
  }).format(value);
};

/**
 * Percentage from a ratio in 0..1.
 *
 * Taking a ratio rather than an already-multiplied number is deliberate: the
 * old copies disagreed about which they expected, which is a silent factor-100
 * bug waiting to happen.
 */
export const formatPercent = (
  ratio: number | null | undefined,
  options: FormatOptions & { decimals?: number; clamp?: boolean } = {},
): string => {
  if (!isNumber(ratio)) return options.fallback ?? EMPTY_VALUE;
  const bounded = options.clamp ? Math.min(1, Math.max(0, ratio)) : ratio;
  return `${(bounded * 100).toFixed(options.decimals ?? 1)}%`;
};

/** Share of a total, guarding the zero-total case the copies kept getting wrong. */
export const formatRatio = (
  part: number | null | undefined,
  total: number | null | undefined,
  options: FormatOptions & { decimals?: number } = {},
): string =>
  !isNumber(part) || !isNumber(total) || total === 0 ? (options.fallback ?? EMPTY_VALUE) : formatPercent(part / total, options);

/**
 * Duration from a measured millisecond count.
 *
 * Distinct from `dates.formatDuration`, which takes two timestamps: a span's
 * `durationMs`, a request latency or a timeout budget never had timestamps to
 * subtract.
 */
export const formatDurationMs = (ms: number | null | undefined, options: FormatOptions = {}): string => {
  if (!isNumber(ms)) return options.fallback ?? EMPTY_VALUE;
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

/** Byte size. Defaults to SI because storage tooling reports GB, not GiB. */
export const formatBytes = (bytes: number | null | undefined, options: FormatOptions & { mode?: "iec" | "si" } = {}): string =>
  isNumber(bytes) ? text.pprintBytes(bytes, options.mode ?? "si") : (options.fallback ?? EMPTY_VALUE);

/**
 * Absolute date and time in the viewer's locale and timezone.
 *
 * Pass the request's `DateContext` from `getDateConfig(c)`; without it stdlib
 * falls back to the host settings, which is what the hardcoded `de-DE`
 * formatters did permanently.
 */
export const formatDateTime = (value: string | Date | null | undefined, context?: DateContext, options: FormatOptions = {}): string =>
  value === null || value === undefined ? (options.fallback ?? EMPTY_VALUE) : dates.formatDateTime(value, context);

export const formatDate = (value: string | Date | null | undefined, context?: DateContext, options: FormatOptions = {}): string =>
  value === null || value === undefined ? (options.fallback ?? EMPTY_VALUE) : dates.formatDate(value, context);

/** Relative time such as "3 minutes ago", for freshness rather than record-keeping. */
export const formatRelative = (value: string | Date | null | undefined, context?: DateContext, options: FormatOptions = {}): string =>
  value === null || value === undefined ? (options.fallback ?? EMPTY_VALUE) : dates.formatTimeSpan(value, context);
