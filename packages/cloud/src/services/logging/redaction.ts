/**
 * Keys whose values are scrubbed from log and trace metadata before storage.
 * Match is case-insensitive and substring-based on the key (e.g. `apiKey`,
 * `accessToken`, `clientSecret` all trip).
 */
const SENSITIVE_KEY_PATTERN = /(password|secret|token|cookie|authorization|api[_-]?key|private[_-]?key|session)/i;

export const REDACTED = "[REDACTED]";

export const isSensitiveMetadataKey = (key: string): boolean => SENSITIVE_KEY_PATTERN.test(key);

export const redactMetadata = (input: unknown): unknown => {
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redactMetadata);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = isSensitiveMetadataKey(key) ? REDACTED : redactMetadata(value);
  }
  return out;
};
