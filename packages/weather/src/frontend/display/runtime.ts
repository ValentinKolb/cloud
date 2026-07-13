export const DEFAULT_DISPLAY_REFRESH_SECONDS = 60;
export const MIN_DISPLAY_REFRESH_SECONDS = 10;
const MAX_DISPLAY_RETRY_DELAY_MS = 5 * 60_000;

export const parseDisplayCoordinate = (value: string | null | undefined, min: number, max: number): string | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? value : null;
};

export const parseDisplayRefreshSeconds = (value: string | null | undefined): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Math.max(MIN_DISPLAY_REFRESH_SECONDS, Number.isFinite(parsed) ? parsed : DEFAULT_DISPLAY_REFRESH_SECONDS);
};

export const displayRefreshBackoffMs = (refreshSeconds: number, failures: number): number => {
  const baseDelay = Math.max(MIN_DISPLAY_REFRESH_SECONDS, refreshSeconds) * 1_000;
  const retryCap = Math.max(baseDelay, MAX_DISPLAY_RETRY_DELAY_MS);
  return Math.min(retryCap, baseDelay * 2 ** Math.max(0, failures));
};
