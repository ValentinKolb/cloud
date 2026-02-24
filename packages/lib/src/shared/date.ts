const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Format a date as "26.Jan.2025" (UTC) */
export const formatDate = (input: string | Date): string => {
  const d = typeof input === "string" ? new Date(input) : input;
  const day = d.getUTCDate();
  const month = months[d.getUTCMonth()]!;
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
};

/** Format a date as "13:53 26.Jan.2025" (UTC) */
export const formatDateTime = (input: string | Date): string => {
  const d = typeof input === "string" ? new Date(input) : input;
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} ${formatDate(d)}`;
};

/**
 * Format a date relative to now.
 * - Today: "14:30"
 * - Yesterday: "Yesterday"
 * - Within 7 days: "Mon", "Tue", etc.
 * - Older: "26.01.25"
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

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
};

export const dates = {
  formatDate,
  formatDateTime,
  formatDateRelative,
} as const;
