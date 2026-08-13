export const projectCustomAppRecord = <T extends { data: Record<string, unknown> }>(
  record: T,
  fieldIds: readonly string[],
): Omit<T, "data"> & { data: Record<string, unknown> } => {
  const allowed = new Set(fieldIds);
  return {
    ...record,
    data: Object.fromEntries(Object.entries(record.data).filter(([fieldId]) => allowed.has(fieldId))),
  };
};
