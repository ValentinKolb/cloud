/**
 * Environment variable parsing.
 * All env vars are parsed and validated here, then exported as typed `env` object.
 */

const str = (key: string, fallback: string = ""): string => process.env[key] ?? fallback;

const int = (key: string, fallback: number): number => {
  const value = process.env[key];
  const parsed = parseInt(value ?? "", 10);
  return isNaN(parsed) ? fallback : parsed;
};

export const env = {
  // Application (infrastructure — not changeable at runtime)
  APP_SECRET: str("APP_SECRET"),
  PORT: int("PORT", 3000),
  IS_DEVELOPMENT: process.env.NODE_ENV === "development",

  // Admin login (local emergency access — token-based, no IPA required)
  ADMIN_LOGIN_TOKEN: str("ADMIN_LOGIN_TOKEN"),
} as const;
