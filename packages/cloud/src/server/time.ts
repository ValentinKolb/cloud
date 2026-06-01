import { dates, type DateContext } from "@valentinkolb/stdlib";
import { TIMEZONE_COOKIE } from "../shared/time";

export { TIMEZONE_COOKIE };

type TimeContext = {
  get(key: "settings"): Record<string, any> | undefined;
  req: { raw: { headers: Headers } };
};

const readCookie = (headers: Headers, name: string): string | undefined => {
  const cookie = headers.get("Cookie");
  if (!cookie) return undefined;

  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== name) continue;
    const value = rawValue.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
};

export const getTimeZone = (c: TimeContext): string => {
  const settingsTimeZone = c.get("settings")?.app?.timezone;
  const fallback = dates.normalizeTimeZone(typeof settingsTimeZone === "string" ? settingsTimeZone : undefined, "UTC");
  return dates.normalizeTimeZone(readCookie(c.req.raw.headers, TIMEZONE_COOKIE), fallback);
};

export const getDateConfig = (c: TimeContext): DateContext => ({
  timeZone: getTimeZone(c),
  locale: "en",
  firstDayOfWeek: 1,
});

export const time = {
  TIMEZONE_COOKIE,
  getTimeZone,
  getDateConfig,
} as const;
