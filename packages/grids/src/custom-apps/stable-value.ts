export const stableCustomAppValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableCustomAppValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableCustomAppValue(item)]),
    );
  }
  return value;
};

export const stableCustomAppStringify = (value: unknown): string => JSON.stringify(stableCustomAppValue(value));
