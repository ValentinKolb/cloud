/**
 * Cookie Utilities
 *
 * Centralized cookie read/write operations for client-side code.
 * Handles JSON encoding/decoding and provides type-safe access.
 */

const DEFAULT_MAX_AGE = 31536000; // 1 year in seconds

/**
 * Read a JSON-encoded cookie value.
 * Returns defaultValue if cookie doesn't exist or parsing fails.
 */
export const readJsonCookie = <T>(name: string, defaultValue: T): T => {
  try {
    const cookie = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
    if (cookie) {
      const value = decodeURIComponent(cookie.split("=")[1]!);
      return { ...defaultValue, ...JSON.parse(value) };
    }
  } catch {
    // Ignore parse errors, return default
  }
  return defaultValue;
};

/**
 * Write a JSON-encoded cookie value.
 */
export const writeJsonCookie = <T>(name: string, data: T, maxAge = DEFAULT_MAX_AGE) => {
  document.cookie = `${name}=${encodeURIComponent(JSON.stringify(data))}; path=/; max-age=${maxAge}; SameSite=Lax`;
};

/**
 * Read a simple string cookie value.
 * Returns null if cookie doesn't exist.
 */
export const readCookie = (name: string): string | null => {
  const cookie = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  if (cookie) {
    return decodeURIComponent(cookie.split("=")[1]!);
  }
  return null;
};

/**
 * Write a simple string cookie value.
 */
export const writeCookie = (name: string, value: string, maxAge = DEFAULT_MAX_AGE) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
};

/**
 * Delete a cookie by setting its max-age to 0.
 */
export const deleteCookie = (name: string) => {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
};

export const cookies = {
  readJsonCookie,
  writeJsonCookie,
  readCookie,
  writeCookie,
  deleteCookie,
} as const;
