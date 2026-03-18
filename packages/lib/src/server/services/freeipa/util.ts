export class IpaError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "IpaError";
  }
}

export type DbRow = Record<string, unknown>;

export const str = (val: unknown): string => {
  if (Array.isArray(val)) return String(val[0] ?? "");
  return String(val ?? "");
};

export const num = (val: unknown): number | null => {
  const raw = Array.isArray(val) ? val[0] : val;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
};

export const parseGeneralizedTime = (val: unknown): Date | null => {
  let raw = Array.isArray(val) ? val[0] : val;
  if (raw && typeof raw === "object" && "__datetime__" in raw) {
    raw = (raw as Record<string, unknown>).__datetime__;
  }
  const s = typeof raw === "string" ? raw : "";
  if (!s || s.length < 14) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const toGeneralizedTime = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}${h}${min}${s}Z`;
};

export const escapeLike = (value: string): string => value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

export const toExcludedGroupsSet = (groups: string[]): Set<string> => new Set(groups.map((group) => group.trim()).filter(Boolean));

export const mapIpaErrorCode = (code: number): 400 | 401 | 403 => {
  if (code === 4001) return 401;
  if (code === 4301) return 403;
  return 400;
};

export const toPgTextArray = (values: string[] | null | undefined): string => {
  if (!Array.isArray(values) || values.length === 0) return "{}";
  return `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
};
