type ErrorWriter = (message: string, metadata?: Record<string, unknown>) => void;

export const logDatabaseFailure = (
  write: ErrorWriter,
  operation: string,
  resource: "provider binding" | "provider connection",
  error: unknown,
): void => {
  const value = error as { code?: unknown; constraint?: unknown } | null;
  write(`Failed to ${operation} ${resource}`, {
    code: typeof value?.code === "string" ? value.code : "UNKNOWN",
    constraint: typeof value?.constraint === "string" ? value.constraint : null,
  });
};
