const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pluralize = (value: number, unit: string): string => `${value} ${unit}${value === 1 ? "" : "s"} ago`;

/** Format a date as "05 Mar 2025" (UTC). */
export const formatDate = (input: string | Date): string => {
  const d = typeof input === "string" ? new Date(input) : input;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = months[d.getUTCMonth()]!;
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
};

/** Format a date/time as "05 Mar 2025, 13:53" (UTC). */
export const formatDateTime = (input: string | Date): string => {
  const d = typeof input === "string" ? new Date(input) : input;
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(d)}, ${hours}:${minutes}`;
};

/** Format a date/time as "just now", "12 sec ago", "4 min ago", "2 hours ago", "Yesterday", etc. */
export const formatDateTimeRelative = (input: string | Date): string => {
  const d = typeof input === "string" ? new Date(input) : input;
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
  const d = typeof input === "string" ? new Date(input) : input;
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

export const dates = {
  formatDate,
  formatDateTime,
  formatDateTimeRelative,
  formatDateRelative,
} as const;
