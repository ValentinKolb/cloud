// ==========================
// Core Result Types
// ==========================

export type ServiceErrorCode = "BAD_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INTERNAL";

export type ServiceError<C extends string = string> = {
  code: C;
  message: string;
  status: 400 | 401 | 403 | 404 | 409 | 500;
};

export type Result<T = void, E extends ServiceError = ServiceError> = { ok: true; data: T } | { ok: false; error: E };

export type PageParams = {
  page?: number;
  perPage?: number;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  hasNext: boolean;
};

// ==========================
// Constructors
// ==========================

/**
 * Builds a successful service result (with optional payload).
 */
export function ok(): Result<void, never>;
export function ok<T>(data: T): Result<T, never>;
export function ok(data?: unknown): Result<unknown, never> {
  return { ok: true, data: data ?? undefined };
}

export const okMany = <T>(items: T[], info: { page: number; perPage: number; total: number }): Result<Paginated<T>, never> => ({
  ok: true,
  data: {
    items,
    ...info,
    hasNext: info.page * info.perPage < info.total,
  },
});

export const fail = <E extends ServiceError>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

// ==========================
// Error Helpers
// ==========================

export const err = {
  badInput: (why: string) =>
    ({
      code: "BAD_INPUT" as const,
      message: why,
      status: 400 as const,
    }) satisfies ServiceError<ServiceErrorCode>,
  unauthenticated: (why = "Authentication required") =>
    ({
      code: "UNAUTHENTICATED" as const,
      message: why,
      status: 401 as const,
    }) satisfies ServiceError<ServiceErrorCode>,
  forbidden: (why = "Insufficient permissions") =>
    ({
      code: "FORBIDDEN" as const,
      message: why,
      status: 403 as const,
    }) satisfies ServiceError<ServiceErrorCode>,
  notFound: (what: string) =>
    ({
      code: "NOT_FOUND" as const,
      message: `${what} not found`,
      status: 404 as const,
    }) satisfies ServiceError<ServiceErrorCode>,
  conflict: (what: string) =>
    ({
      code: "CONFLICT" as const,
      message: `${what} already exists`,
      status: 409 as const,
    }) satisfies ServiceError<ServiceErrorCode>,
  internal: (why = "Internal server error") =>
    ({
      code: "INTERNAL" as const,
      message: why,
      status: 500 as const,
    }) satisfies ServiceError<ServiceErrorCode>,
};

// ==========================
// Helpers
// ==========================

/**
 * Normalizes pagination input and computes a stable offset for DB queries.
 */
export const paginate = (params?: PageParams) => {
  const page = params?.page ?? 1;
  const perPage = params?.perPage ?? 20;
  return { page, perPage, offset: (page - 1) * perPage };
};

export const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw result.error;
  return result.data;
};

/**
 * Guards unknown values as service errors for safe error mapping.
 */
export const isServiceError = (value: unknown): value is ServiceError => {
  if (typeof value !== "object" || value === null) return false;
  const e = value as { code?: unknown; message?: unknown; status?: unknown };
  return typeof e.code === "string" && typeof e.message === "string" && typeof e.status === "number";
};

export const tryCatch = async <T>(fn: () => Promise<T>, onError?: (error: unknown) => ServiceError): Promise<Result<T>> => {
  try {
    return ok(await fn());
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    const mapped = onError?.(error) ?? err.internal(error instanceof Error ? error.message : String(error));
    return fail(mapped);
  }
};
