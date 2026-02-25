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

const list = (key: string, fallback: string = ""): string[] =>
  (process.env[key] ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  // Application (infrastructure — not changeable at runtime)
  APP_URL: str("APP_URL", "localhost:3000"),
  PORT: int("PORT", 3000),
  IS_DEVELOPMENT: process.env.NODE_ENV === "development",

  // FreeIPA (infrastructure)
  FREEIPA_URL: str("FREEIPA_URL", "freeipa.ipa.example.com"),
  FREEIPA_SVC_USER: str("FREEIPA_SVC_USER", "svc-cloud"),
  FREEIPA_SVC_PASSWORD: str("FREEIPA_SVC_PASSWORD"),

  // Access Control Groups (infrastructure)
  GROUPS_ADMIN: list("GROUPS_ADMIN", "admins"),
  GROUPS_BASE_SYNC: list("GROUPS_BASE_SYNC", "users"),
  GROUPS_BASE_IPA_REALM: list("GROUPS_BASE_IPA_REALM", "cloud"),
  GROUPS_EXCLUDED: list("GROUPS_EXCLUDED", "editors,trust admins,admins"),

  // Filegate (infrastructure endpoint + secret)
  FILEGATE_URL: str("FILEGATE_URL", "http://localhost:4000"),
  FILEGATE_TOKEN: str("FILEGATE_TOKEN"),
} as const;
