/**
 * Normalizes optional file paths into the canonical app format (root or `/a/b`).
 */
const normalizePath = (path?: string | null): string => {
  const raw = (path ?? "/").trim();
  if (raw === "" || raw === "/") return "/";
  const trimmed = raw.replace(/^\/+/, "");
  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  return `/${segments.join("/")}`;
};

/**
 * Encodes raw path segments so generated URLs are deterministic and safe.
 */
const encodePathSegments = (path: string): string => {
  const normalized = normalizePath(path);
  if (normalized === "/") return "";
  return normalized
    .slice(1)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
};

/**
 * Decodes URL-safe segments back into the original app path representation.
 */
export const decodeHomeSegments = (segments: string[]): string => {
  if (segments.length === 0) return "/";
  return `/${segments.map((segment) => decodeURIComponent(segment)).join("/")}`;
};

/**
 * Builds the base UI URL for a file base (`home` or `group`).
 */
export const filePageBaseUrl = (baseType: string, baseId: string): string => {
  if (baseType === "home") return "/app/files/home";
  return `/app/files/group/${encodeURIComponent(baseId)}`;
};

/**
 * Builds a full file UI URL and applies the home/group path conventions.
 */
export const filePageUrl = (baseType: string, baseId: string, path?: string | null): string => {
  const baseUrl = filePageBaseUrl(baseType, baseId);
  const normalizedPath = normalizePath(path);
  if (normalizedPath === "/") return baseUrl;

  if (baseType === "home") {
    return `${baseUrl}/${encodePathSegments(normalizedPath)}`;
  }

  return `${baseUrl}?path=${encodeURIComponent(normalizedPath)}`;
};
