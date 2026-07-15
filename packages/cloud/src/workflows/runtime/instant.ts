export const normalizeWorkflowInstant = (name: string, value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw new Error(`${name} must be an ISO date-time with a timezone`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be an ISO date-time with a timezone`);
  return new Date(timestamp).toISOString();
};
