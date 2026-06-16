export const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export { toPgUuidArray } from "@valentinkolb/cloud/services";

export type JsonRecord = Record<string, unknown>;

export const emptyToNull = (value: string | null | undefined): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export const toJsonb = (value: JsonRecord | null | undefined): string => JSON.stringify(value ?? {});

export const parseJsonRecord = (value: unknown): JsonRecord => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonRecord;
    }
  } catch {
    return {};
  }
  return {};
};

export const normalizeCurrency = (value: string | null | undefined): string => (value ?? "EUR").trim().toUpperCase().slice(0, 3) || "EUR";

export const normalizeCountry = (value: string | null | undefined): string => (value ?? "DE").trim().toUpperCase().slice(0, 2) || "DE";

export const slugify = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
};

export const toDateOnly = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
};
