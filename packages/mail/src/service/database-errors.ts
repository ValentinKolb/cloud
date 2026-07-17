type ErrorWriter = (message: string, metadata?: Record<string, unknown>) => void;

export const logDatabaseFailure = (
  write: ErrorWriter,
  operation: string,
  resource: "provider binding" | "provider connection",
  error: unknown,
): void => {
  const value = error as { code?: unknown; errno?: unknown; constraint?: unknown; constraint_name?: unknown } | null;
  write(`Failed to ${operation} ${resource}`, {
    code: typeof value?.code === "string" ? value.code : typeof value?.errno === "string" ? value.errno : "UNKNOWN",
    constraint:
      typeof value?.constraint === "string"
        ? value.constraint
        : typeof value?.constraint_name === "string"
          ? value.constraint_name
          : null,
  });
};
