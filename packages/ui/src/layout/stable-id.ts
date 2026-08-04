const STABLE_UI_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const isStableUiId = (value: unknown, maxLength = 64): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maxLength && STABLE_UI_ID.test(value);

export const assertStableUiId = (value: string, label: string, maxLength = 64): string => {
  if (!isStableUiId(value, maxLength)) {
    throw new Error(`${label} must start with a letter and contain only letters, numbers, underscores, or hyphens.`);
  }
  return value;
};

export const assertUniqueStableUiIds = (values: readonly string[], label: string, maxLength = 64): void => {
  const seen = new Set<string>();
  values.forEach((value) => {
    assertStableUiId(value, label, maxLength);
    if (seen.has(value)) throw new Error(`${label} must be unique; received duplicate id "${value}".`);
    seen.add(value);
  });
};
