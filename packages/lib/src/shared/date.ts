const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pluralize = (value: number, unit: string): string => `${value} ${unit}${value === 1 ? "" : "s"} ago`;
const asDate = (input: string | Date): Date => (typeof input === "string" ? new Date(input) : input);
const formatDurationPart = (value: number, label: string): string => `${value} ${label}${value === 1 ? "" : "s"}`;

/** Format a date as "05 Mar 2025" (UTC). */
export const formatDate = (input: string | Date): string => {
  const d = asDate(input);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = months[d.getUTCMonth()]!;
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
};

/** Format a date/time as "05 Mar 2025, 13:53" (UTC). */
export const formatDateTime = (input: string | Date): string => {
  const d = asDate(input);
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(d)}, ${hours}:${minutes}`;
};

/** Format a date/time as "just now", "12 sec ago", "4 min ago", "2 hours ago", "Yesterday", etc. */
export const formatDateTimeRelative = (input: string | Date): string => {
  const d = asDate(input);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  if (diffMs < 5_000) return "just now";
  if (diffMs < 60_000) return pluralize(Math.max(1, Math.floor(diffMs / 1_000)), "sec");
  if (diffMs < 60 * 60 * 1000) return pluralize(Math.max(1, Math.floor(diffMs / (60 * 1000))), "min");
  if (diffMs < 24 * 60 * 60 * 1000) return pluralize(Math.max(1, Math.floor(diffMs / (60 * 60 * 1000))), "hour");
  if (diffMs < 48 * 60 * 60 * 1000) return "Yesterday";
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return weekdays[d.getDay()]!;
  return formatDate(d);
};

/**
 * Format a date relative to now.
 * - Today: "14:30"
 * - Yesterday: "Yesterday"
 * - Within 7 days: "Mon", "Tue", etc.
 * - Older: "05 Mar 2025"
 */
export const formatDateRelative = (input: string | Date): string => {
  const d = asDate(input);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  if (diffDays === 1) {
    return "Yesterday";
  }

  if (diffDays < 7) {
    return weekdays[d.getDay()]!;
  }

  return formatDate(d);
};

/** Format a timestamp relative to a base time like "in 3 days" or "2 hours ago". */
export const formatTimeSpan = (input: string | Date, base: string | Date = new Date()): string => {
  const target = asDate(input);
  const origin = asDate(base);
  const diffMs = target.getTime() - origin.getTime();
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (absMs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (absMs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  if (absMs < week) return rtf.format(Math.round(diffMs / day), "day");
  return rtf.format(Math.round(diffMs / week), "week");
};

/** Format an absolute duration between two timestamps like "2 hours" or "1 day 3 hours". */
export const formatDuration = (from: string | Date, to: string | Date): string => {
  const start = asDate(from);
  const end = asDate(to);
  const diffMs = Math.abs(end.getTime() - start.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "less than a minute";

  const days = Math.floor(diffMs / day);
  const hours = Math.floor((diffMs % day) / hour);
  const minutes = Math.floor((diffMs % hour) / minute);

  if (days > 0) {
    return [formatDurationPart(days, "day"), hours > 0 ? formatDurationPart(hours, "hour") : null].filter(Boolean).join(" ");
  }
  if (hours > 0) {
    return [formatDurationPart(hours, "hour"), minutes > 0 ? formatDurationPart(minutes, "minute") : null].filter(Boolean).join(" ");
  }
  return formatDurationPart(minutes, "minute");
};

export const dates = {
  formatDate,
  formatDateTime,
  formatDateTimeRelative,
  formatDateRelative,
  formatTimeSpan,
  formatDuration,
} as const;
