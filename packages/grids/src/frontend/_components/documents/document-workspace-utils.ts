import { type DateContext, dates } from "@k2b/stdlib";

export const formatDocumentRelativeTime = (iso: string, dateConfig?: DateContext): string => dates.formatDateTimeRelative(iso, dateConfig);

export const formatDocumentDateTime = (iso: string, dateConfig?: DateContext): string =>
  new Intl.DateTimeFormat(dateConfig?.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: dateConfig?.timeZone,
  }).format(new Date(iso));

export const formatDocumentMonth = (year: string, month: string, dateConfig?: DateContext): string => {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat(dateConfig?.locale, { month: "long", timeZone: "UTC" }).format(date);
};
