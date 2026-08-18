import { err, fail, ok, type Result } from "@k2b/stdlib";

const parseGroupedColumnKey = (key: string): { parts: string[]; fieldId: string } | null => {
  const parts = key.split(":");
  if ((parts[0] !== "group" && parts[0] !== "agg") || parts.length < 4) return null;
  return { parts, fieldId: parts[2]! };
};

export const groupedColumnFieldId = (key: string): string | null => parseGroupedColumnKey(key)?.fieldId ?? null;

export const rewriteGroupedColumnKeys = (
  keys: readonly string[] | undefined,
  resolveFieldId: (fieldId: string) => string | null,
): Result<string[] | undefined> => {
  if (!keys) return ok(undefined);
  const converted: string[] = [];
  for (const key of keys) {
    const parsed = parseGroupedColumnKey(key);
    if (!parsed || parsed.fieldId === "*") {
      converted.push(key);
      continue;
    }
    const fieldId = resolveFieldId(parsed.fieldId);
    if (!fieldId) return fail(err.badInput("Unknown field ID in grouped column"));
    parsed.parts[2] = fieldId;
    converted.push(parsed.parts.join(":"));
  }
  return ok(converted);
};
