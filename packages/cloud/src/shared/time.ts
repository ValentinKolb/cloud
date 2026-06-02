export const TIMEZONE_COOKIE = "cloud.timezone";

export const normalizeTimeZone = (value: string | null | undefined, fallback = "UTC"): string => {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return fallback;

  try {
    new Intl.DateTimeFormat(undefined, { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback;
  }
};
